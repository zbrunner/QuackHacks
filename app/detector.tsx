import { Ionicons } from "@expo/vector-icons";
import {
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Directions,
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/use-auth";
import { addPersonalListItem } from "@/src/services/listService";

const SERVER_URL = "http://10.0.0.66:3000";

const DEFAULT_LIST = [
  "milk",
  "bread",
  "cheerios",
  "nutrition drink",
  "apple",
];

const DETECT_INTERVAL_MS = 1500;
const DETECT_INTERVAL_FINDING_MS = 500;
const MAX_IN_FLIGHT_DETECTS = 4;
const RECORD_CHUNK_MS = 4000;

type DetectionPosition = {
  horizontal: string;
  vertical: string;
  distance: string;
};

type Match = {
  name: string;
  matchedFor: string;
  cx: number;
  cy: number;
  position: DetectionPosition;
};

type Target = {
  key: string;
  name: string;
  matchedFor: string;
  lastDetection: { cx: number; cy: number } | null;
};

type VoiceMode = "idle" | "listing" | "finding";

const matchKey = (m: { matchedFor: string }) =>
  (m.matchedFor || "").toLowerCase();

// Map ElevenLabs / expo-audio metering (dB, typically -120..0) to a 0..100
// percentage. Speech sits roughly between -40 and -10 dB.
const meterPct = (db: number | undefined | null) => {
  if (db == null || !Number.isFinite(db)) return 0;
  const min = -50;
  const max = -5;
  const clamped = Math.max(min, Math.min(max, db));
  return Math.round(((clamped - min) / (max - min)) * 100);
};
const meterColor = (db: number | undefined | null) => {
  const pct = meterPct(db);
  if (pct < 15) return "#666"; // dead silence — looks gray
  if (pct < 40) return "#4ade80"; // quiet speech
  return "#22c55e"; // clear speech
};

const END_LIST_RE = /\b(end|stop|finish|done|save|complete)\s+(the\s+)?(list|listing)\b|\bdone listing\b|\bsave (it|that|the list)\b/;
const STOP_FIND_RE = /\b(stop|cancel|found it|got it|done|never mind|abort|exit)\b/;
const START_LIST_RE = /\b(start|begin|new|build|create|make)\s+(a\s+|the\s+)?list\b/;
const FIND_RE = /\b(help me find|find( it| this| the| target| item)?|locate|where is|guide me)\b/;
const READ_RE =
  /\bread\b.*\b(this|it|that|text|label|sign|package)\b|^read$|\bwhat does (it|this|that) say\b/;
const STOP_APP_RE =
  /^(stop|exit|close|back|quit)$|\b(stop|exit|close) (detection|app)\b|\bgo back\b/;
const HELP_RE = /^help$|\bwhat can i (say|do)\b|\blist commands\b/;

export default function Detector() {
  const router = useRouter();
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  // Native on-device STT via Apple's SFSpeechRecognizer / Android's
  // SpeechRecognizer. Sidesteps the AVAudioRecorder bug entirely.
  const [meterDb, setMeterDb] = useState<number | null>(null);
  const wasLoopingRef = useRef(false);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const pingLoopPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(
    null
  );
  const listenPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(
    null
  );

  // Refs preserve mutable state accessed inside async loops without re-renders.
  const isMountedRef = useRef(true);
  const inFlightDetectsRef = useRef(0);
  const lastAnnouncedMatchRef = useRef<Target | null>(null);
  const findingTargetRef = useRef<Target | null>(null);
  const announcedKeysRef = useRef<Set<string>>(new Set());
  const currentMatchesRef = useRef<Match[]>([]);
  const voiceModeRef = useRef<VoiceMode>("idle");
  const listingItemsRef = useRef<string[]>([]);
  const groceryListRef = useRef<string[]>(DEFAULT_LIST);
  const readingRef = useRef(false);
  const listeningRef = useRef(false);

  const [voiceMode, setVoiceModeState] = useState<VoiceMode>("idle");
  const [findingTarget, setFindingTargetState] = useState<Target | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [status, setStatus] = useState("starting…");
  const [heard, setHeard] = useState<string>("");
  const [isRecording, setIsRecording] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const welcomeSpokenRef = useRef(false);
  // Toggled to false during recording so iOS fully releases the camera
  // capture session (just pausePreview isn't enough to stop the mic conflict).
  const [cameraVisible, setCameraVisible] = useState(true);

  const log = useCallback((level: string, msg: string) => {
    const t = new Date().toTimeString().slice(0, 8);
    const line = `[${t}] ${level.padEnd(6)} ${msg}`;
    setLogs((prev) => {
      const next = prev.length >= 30 ? [...prev.slice(1), line] : [...prev, line];
      return next;
    });
    console.log(line);
  }, []);

  const setVoiceMode = (m: VoiceMode) => {
    voiceModeRef.current = m;
    setVoiceModeState(m);
  };
  const setFindingTarget = (t: Target | null) => {
    findingTargetRef.current = t;
    setFindingTargetState(t);
  };

  // ----- Setup: orientation, audio mode, mic permission, cleanup -----
  // Stable PlayAndRecord session — toggling categories appears to break the
  // recorder on second/third attempts. We accept slightly quieter playback
  // for reliability. shouldRouteThroughEarpiece: false attempts to force the
  // main speaker even in PlayAndRecord mode.
  const setPlaybackMode = useCallback(() => Promise.resolve(), []);
  const setRecordMode = useCallback(() => Promise.resolve(), []);

  useEffect(() => {
    log("init", "detector mounted");
    // Playback-only audio session. Native STT manages its own mic capture
    // (AVAudioEngine on iOS), so we don't need PlayAndRecord here.
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
    }).catch(() => {});
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT
    ).catch(() => {});
    ExpoSpeechRecognitionModule.requestPermissionsAsync()
      .then((perm: any) =>
        log("init", `speech perm granted=${perm?.granted ?? "?"}`)
      )
      .catch((e: any) => log("error", `perm: ${e?.message || e}`));
    try {
      // Looping ping track — native audio engine handles ping cadence smoothly.
      const loopPlayer = createAudioPlayer(
        require("@/assets/sounds/ping-loop.wav")
      );
      try {
        (loopPlayer as any).loop = true;
      } catch {}
      pingLoopPlayerRef.current = loopPlayer;
      listenPlayerRef.current = createAudioPlayer(
        require("@/assets/sounds/listen.wav")
      );
    } catch (err: any) {
      log("error", `audio load: ${err?.message || err}`);
    }
    return () => {
      isMountedRef.current = false;
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => {});
      if (playerRef.current) {
        try {
          playerRef.current.remove();
        } catch {}
        playerRef.current = null;
      }
      if (pingLoopPlayerRef.current) {
        try {
          pingLoopPlayerRef.current.remove();
        } catch {}
        pingLoopPlayerRef.current = null;
      }
      if (listenPlayerRef.current) {
        try {
          listenPlayerRef.current.remove();
        } catch {}
        listenPlayerRef.current = null;
      }
      listeningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- TTS playback -----
  const speak = useCallback(
    (text: string) => {
      try {
        // Per #43086: flip to playback mode right before play.
        setPlaybackMode();
        const url = `${SERVER_URL}/speak?text=${encodeURIComponent(text)}`;
        if (playerRef.current) {
          try {
            playerRef.current.remove();
          } catch {}
        }
        const player = createAudioPlayer({ uri: url });
        playerRef.current = player;
        player.play();
      } catch (err) {
        console.warn("speak error", err);
      }
    },
    [setPlaybackMode]
  );

  // Same as speak() but resolves when playback finishes (or after a safety
  // timeout). Use this when downstream logic must wait for the speech to end.
  const speakAwait = useCallback(
    (text: string, maxWaitMs = 6000): Promise<void> => {
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        try {
          const url = `${SERVER_URL}/speak?text=${encodeURIComponent(text)}`;
          if (playerRef.current) {
            try {
              playerRef.current.remove();
            } catch {}
          }
          const player = createAudioPlayer({ uri: url });
          playerRef.current = player;
          try {
            const sub = (player as any).addListener?.(
              "playbackStatusUpdate",
              (status: any) => {
                if (status?.didJustFinish || status?.playbackState === "ended") {
                  try {
                    sub?.remove?.();
                  } catch {}
                  finish();
                }
              }
            );
          } catch {}
          player.play();
        } catch (err) {
          // Fall through to timeout
        }
        setTimeout(finish, maxWaitMs);
      });
    },
    []
  );

  // ----- "Read this" handler -----
  const readThis = useCallback(async () => {
    if (readingRef.current || !cameraRef.current) return;
    readingRef.current = true;
    speak("Reading.");
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!photo?.uri) return;
      const fileRes = await fetch(photo.uri);
      const blob = await fileRes.blob();
      const res = await fetch(`${SERVER_URL}/read-text`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!res.ok) {
        speak("Could not read text.");
        return;
      }
      const data = await res.json();
      const text = (data.text || "").trim();
      if (!text || /^nothing$/i.test(text)) {
        speak("No text visible.");
      } else {
        speak(text);
      }
    } catch (err: any) {
      speak("Error reading text.");
    } finally {
      readingRef.current = false;
    }
  }, [speak]);

  // ----- Find mode -----
  const startFinding = useCallback(async () => {
    let target: Target | null = lastAnnouncedMatchRef.current;
    // Fall back to a currently visible match if no prior announcement.
    if (!target && currentMatchesRef.current.length > 0) {
      const m = currentMatchesRef.current[0];
      target = {
        key: matchKey(m),
        name: m.name,
        matchedFor: m.matchedFor,
        lastDetection: { cx: m.cx, cy: m.cy },
      };
      log("find", `using visible match: ${m.name}`);
    }
    if (!target) {
      log("find", "no target available");
      speak(
        "No matching item visible. Point the camera at an item from your list."
      );
      return;
    }
    log("find", `start: ${target.name} (${target.matchedFor})`);
    // Speak the intro first; pings only start after the voice finishes.
    await speakAwait(
      `Finding ${target.name}. Sweep the camera; haptics speed up as you center on it.`
    );
    setFindingTarget({
      key: target.key,
      name: target.name,
      matchedFor: target.matchedFor,
      lastDetection: target.lastDetection,
    });
  }, [log, speak, speakAwait]);

  const stopFinding = useCallback(
    (announce = true) => {
      log("find", "stop");
      setFindingTarget(null);
      if (announce) speak("Stopped finding.");
    },
    [log, speak]
  );

  // Find-mode ping system: a looping audio track at native cadence, whose
  // playbackRate is modulated from the latest detection. The native audio
  // engine handles the precise timing — JS only adjusts the rate.
  useEffect(() => {
    if (!findingTarget) return;
    const loop = pingLoopPlayerRef.current;
    if (!loop) {
      log("error", "ping-loop player not loaded");
      return;
    }
    log("haptic", `loop start for ${findingTarget.name}`);

    // Start the loop in playback mode (loud main speaker).
    setPlaybackMode();
    try {
      (loop as any).loop = true;
      loop.seekTo(0);
      loop.play();
    } catch (e: any) {
      log("error", `loop play: ${e?.message || e}`);
    }

    let canceled = false;
    let lastRate = -1;
    let lastSpokenDirection: string | null = null;

    const updateRate = () => {
      if (canceled) return;
      const last = findingTargetRef.current?.lastDetection;
      if (last) {
        const dx = Math.abs(last.cx - 0.5) * 2;
        const dy = Math.abs(last.cy - 0.5) * 2;
        const off = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const centered = 1 - off;
        // Wider range: 0.25× (≈1 ping/sec) at edges → 2× (8 pings/sec) at center.
        const rate = 0.25 + centered * 1.75;
        if (Math.abs(rate - lastRate) > 0.08) {
          try {
            (loop as any).setPlaybackRate(rate);
            lastRate = rate;
            log(
              "ping",
              `rate=${rate.toFixed(2)}× (≈${(rate * 4).toFixed(1)}/s) centered=${centered.toFixed(2)}`
            );
          } catch (e: any) {
            log("error", `setRate: ${e?.message || e}`);
          }
        }
        Haptics.impactAsync(
          centered > 0.8
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light
        ).catch(() => {});
      }
      setTimeout(updateRate, 300);
    };
    updateRate();

    // Direction callouts: speak "left" / "right" / "centered" every 3s while
    // finding. Repeats while off-center; "centered" said once on transition.
    const directionInterval = setInterval(() => {
      if (canceled) return;
      const last = findingTargetRef.current?.lastDetection;
      if (!last) return;
      let dir: string;
      if (last.cx < 0.4) dir = "left";
      else if (last.cx > 0.6) dir = "right";
      else dir = "centered";
      if (dir === "centered") {
        if (lastSpokenDirection !== "centered") {
          speak("centered");
          lastSpokenDirection = "centered";
          log("voice", "callout: centered");
        }
        return;
      }
      speak(dir);
      lastSpokenDirection = dir;
      log("voice", `callout: ${dir}`);
    }, 3000);

    return () => {
      log("haptic", "loop cleanup running");
      canceled = true;
      clearInterval(directionInterval);
      try {
        (loop as any).loop = false;
      } catch {}
      try {
        loop.pause();
        loop.seekTo(0);
        log("haptic", "loop paused & rewound");
      } catch (e: any) {
        log("error", `loop pause: ${e?.message || e}`);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findingTarget?.key]);

  // ----- List dictation -----
  const exitListingMode = useCallback(async () => {
    setVoiceMode("idle");
    const items = listingItemsRef.current;
    listingItemsRef.current = [];
    log("list", `exit with ${items.length} items`);
    if (!items.length) {
      speak("No items added.");
      return;
    }
    let cleaned = items;
    try {
      const res = await fetch(`${SERVER_URL}/clean-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.cleaned) && data.cleaned.length) {
          cleaned = data.cleaned;
        }
      }
    } catch {}
    // Always update the local grocery list so detection picks up new items.
    groceryListRef.current = Array.from(
      new Set([...groceryListRef.current, ...cleaned])
    );
    if (!user) {
      speak(`Added ${cleaned.length} items, but you are not signed in to save them.`);
      return;
    }
    try {
      for (const item of cleaned) {
        await addPersonalListItem(user.uid, user.uid, item);
      }
      log("list", `saved ${cleaned.length} to Firestore`);
      speak(`Saved ${cleaned.length} items to your list.`);
    } catch (err: any) {
      log("error", `list save: ${err.message}`);
      speak("Could not save list. " + (err.message || ""));
    }
  }, [speak, user]);

  // ----- Command handler -----
  const handleUtterance = useCallback(
    (text: string) => {
      const lower = text.toLowerCase().trim();
      if (!lower) return;

      // 1. Listing mode: append, terminator exits.
      if (voiceModeRef.current === "listing") {
        if (END_LIST_RE.test(lower)) {
          log("cmd", "end list");
          exitListingMode();
          return;
        }
        // Run the single item through Gemini /clean-list, store the cleaned
        // version, and read it back so the user can confirm what was added.
        (async () => {
          let toAdd = text;
          try {
            const res = await fetch(`${SERVER_URL}/clean-list`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: [text] }),
            });
            if (res.ok) {
              const data = await res.json();
              const cleaned = (data.cleaned || [])[0];
              if (cleaned && typeof cleaned === "string" && cleaned.trim()) {
                toAdd = cleaned.trim();
              }
            }
          } catch (e: any) {
            log("error", `clean-list: ${e?.message || e}`);
          }
          listingItemsRef.current.push(toAdd);
          log("list", `item: ${toAdd}${toAdd !== text ? ` (cleaned from "${text}")` : ""}`);
          // Use native TTS (expo-speech) here, NOT the ElevenLabs streaming
          // player. The streaming player keeps the iOS audio session locked
          // in playback mode and breaks the very next recording. Native TTS
          // plays cleanly without affecting the session.
          Speech.speak(`Added ${toAdd}`, { rate: 1.05 });
        })();
        return;
      }

      // 2. Finding mode: stop-words exit.
      if (findingTargetRef.current && STOP_FIND_RE.test(lower)) {
        log("cmd", `exit find ("${lower}")`);
        stopFinding(true);
        return;
      }

      // 3. Regular commands.
      if (READ_RE.test(lower)) {
        log("cmd", "read this");
        readThis();
        return;
      }
      if (FIND_RE.test(lower)) {
        log("cmd", "find");
        startFinding();
        return;
      }
      if (START_LIST_RE.test(lower)) {
        log("cmd", "start list");
        listingItemsRef.current = [];
        setVoiceMode("listing");
        speak("Listing. Speak items one at a time. Say end list when done.");
        return;
      }
      if (HELP_RE.test(lower)) {
        log("cmd", "help");
        speak(
          "You can say start list to add items, end list to save them, help me find it to locate the last detected item, read this to read text on a label, or stop to exit."
        );
        return;
      }
      if (STOP_APP_RE.test(lower)) {
        log("cmd", "stop");
        speak("Stopping detection.");
        setTimeout(() => router.back(), 700);
        return;
      }
      log("cmd", `(unrecognized) "${text}"`);
      setHeard(`(unrecognized) ${text}`);
    },
    [exitListingMode, readThis, router, speak, startFinding, stopFinding]
  );

  // ----- Continuous listening: chunked 4s recordings -----
  const sendToTranscribe = useCallback(
    async (uri: string) => {
      try {
        // Use FormData with the file URI directly. React Native streams the
        // file via its native upload path — much more reliable than building
        // a Blob and posting it as the body.
        const formData = new FormData();
        formData.append("audio", {
          uri,
          name: "audio.m4a",
          type: "audio/m4a",
        } as any);
        log("voice", `posting multipart uri=${uri.slice(-30)}`);
        const res = await fetch(`${SERVER_URL}/transcribe`, {
          method: "POST",
          body: formData,
        });
        log("voice", `transcribe HTTP ${res.status}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          log("error", `transcribe ${res.status}: ${errText.slice(0, 100)}`);
          return;
        }
        const data = await res.json();
        log("voice", `data: ${JSON.stringify(data).slice(0, 80)}`);
        const text = (data.text || "").trim();
        if (!text) {
          log("voice", "empty transcription");
          return;
        }
        if (!isMountedRef.current) return;
        log("voice", `heard "${text}"`);
        setHeard(`heard: ${text}`);
        handleUtterance(text);
      } catch (err: any) {
        log("error", `transcribe: ${err?.message || String(err)}`);
        if (isMountedRef.current)
          setHeard(`transcribe error: ${err?.message || err}`);
      }
    },
    [handleUtterance, log]
  );

  const handleTapToTalk = useCallback(async () => {
    if (isRecording) return;
    try {
      const perm =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm?.granted) {
        log("error", "speech permission denied");
        setHeard("speech permission denied");
        return;
      }
      // Pause the ping loop so it doesn't bleed into recognition.
      const loop = pingLoopPlayerRef.current;
      const wasLooping = !!loop && !!(loop as any).playing;
      wasLoopingRef.current = wasLooping;
      if (wasLooping) {
        try {
          loop.pause();
          log("audio", "ping-loop paused for recognition");
        } catch {}
      }
      // Unmount the camera while listening — frees iOS capture resources
      // even though native STT manages its own mic, and it gives the user
      // a clear "Listening…" screen.
      setCameraVisible(false);
      log("audio", "camera unmounted for recognition");
      await new Promise((r) => setTimeout(r, 150));

      // Listen-tone chime.
      if (listenPlayerRef.current) {
        try {
          listenPlayerRef.current.seekTo(0);
          listenPlayerRef.current.play();
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 200));

      setIsRecording(true);
      log("audio", "starting native speech recognition");
      try {
        ExpoSpeechRecognitionModule.start({
          lang: "en-US",
          interimResults: false,
          maxAlternatives: 1,
          continuous: false,
          requiresOnDeviceRecognition: false,
          addsPunctuation: false,
          volumeChangeEventOptions: {
            enabled: true,
            intervalMillis: 200,
          },
          contextualStrings: [
            "build list",
            "start list",
            "end list",
            "save list",
            "find",
            "stop",
            "found it",
            "read this",
            "cereal",
            "milk",
            "bread",
            "cheerios",
          ],
        });
      } catch (e: any) {
        log("error", `speech start: ${e?.message || e}`);
        setIsRecording(false);
        setCameraVisible(true);
      }
    } catch (err: any) {
      log("error", `tap-to-talk: ${err?.message || err}`);
      setIsRecording(false);
      setCameraVisible(true);
    }
  }, [isRecording, log]);

  // ----- Native speech recognition event handlers -----
  useSpeechRecognitionEvent("result", (event: any) => {
    if (!event.isFinal) return;
    const transcript = event.results?.[0]?.transcript;
    if (!transcript) return;
    log("voice", `heard "${transcript}"`);
    setHeard(`heard: ${transcript}`);
    handleUtterance(transcript);
  });

  useSpeechRecognitionEvent("error", (event: any) => {
    log("error", `speech: ${event.error} ${event.message || ""}`);
  });

  useSpeechRecognitionEvent("end", () => {
    log("audio", "speech recognition ended");
    setIsRecording(false);
    setMeterDb(null);
    setCameraVisible(true);
    const loop = pingLoopPlayerRef.current;
    if (wasLoopingRef.current && findingTargetRef.current && loop) {
      try {
        loop.play();
        log("audio", "ping-loop resumed");
      } catch {}
    }
    wasLoopingRef.current = false;
  });

  useSpeechRecognitionEvent("volumechange", (event: any) => {
    // Per the library, value is roughly -2..10 — map to dB-ish scale for our
    // existing meter helpers, which expect dB.
    if (typeof event.value === "number") {
      // -2 (silent) → -50 dB; 10 (loud) → -5 dB
      const dbApprox = -50 + ((event.value + 2) / 12) * 45;
      setMeterDb(dbApprox);
    }
  });

  // ----- Detection loop -----
  const tick = useCallback(async () => {
    if (!cameraRef.current) return;
    if (inFlightDetectsRef.current >= MAX_IN_FLIGHT_DETECTS) return;
    inFlightDetectsRef.current++;
    try {
      const finding = !!findingTargetRef.current;
      const photo = await cameraRef.current.takePictureAsync({
        quality: finding ? 0.3 : 0.5,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!photo?.uri || !isMountedRef.current) return;

      const fileRes = await fetch(photo.uri);
      const blob = await fileRes.blob();
      const detectRes = await fetch(`${SERVER_URL}/detect`, {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "X-Grocery-List": groceryListRef.current.join(","),
        },
        body: blob,
      });
      if (!isMountedRef.current) return;
      if (!detectRes.ok) {
        log("error", `detect HTTP ${detectRes.status}`);
        setStatus(`detect HTTP ${detectRes.status}`);
        return;
      }
      const data = await detectRes.json();
      const objects = (data.objects || []) as Match[];
      const matched = objects.filter((o) => o && o.matchedFor);
      currentMatchesRef.current = matched;
      setMatches(matched);
      setStatus(`${objects.length} objects, ${matched.length} match`);
      if (matched.length) {
        log(
          "detect",
          `${objects.length} obj, ${matched.length} match: ${matched
            .map((m) => m.matchedFor)
            .join(", ")}`
        );
      }

      // Update lastAnnouncedMatch + findingTarget.lastDetection.
      const seenThisFrame = new Set<string>();
      let targetSeenInFrame = false;
      for (const m of matched) {
        const key = matchKey(m);
        if (!key) continue;
        seenThisFrame.add(key);
        if (findingTargetRef.current && key === findingTargetRef.current.key) {
          findingTargetRef.current.lastDetection = { cx: m.cx, cy: m.cy };
          targetSeenInFrame = true;
          log(
            "find",
            `target seen cx=${m.cx.toFixed(2)} cy=${m.cy.toFixed(2)}`
          );
        }
      }
      if (findingTargetRef.current && !targetSeenInFrame) {
        log(
          "find",
          `target MISSED. visible keys: [${Array.from(seenThisFrame).join(", ") || "none"}], looking for "${findingTargetRef.current.key}"`
        );
      }

      // Suppress generic announcements while finding (haptics carry the signal).
      if (findingTargetRef.current) {
        announcedKeysRef.current = new Set(
          Array.from(announcedKeysRef.current).filter((k) =>
            seenThisFrame.has(k)
          )
        );
        return;
      }

      // Announce one new match per frame.
      for (const m of matched) {
        const key = matchKey(m);
        if (!key || announcedKeysRef.current.has(key)) continue;
        announcedKeysRef.current.add(key);
        lastAnnouncedMatchRef.current = {
          key,
          name: m.name,
          matchedFor: m.matchedFor,
          lastDetection: { cx: m.cx, cy: m.cy },
        };
        speak(`${m.name}, ${m.position.horizontal}, ${m.position.distance}`);
        break;
      }
      announcedKeysRef.current = new Set(
        Array.from(announcedKeysRef.current).filter((k) =>
          seenThisFrame.has(k)
        )
      );
    } catch (err: any) {
      if (isMountedRef.current) setStatus(`error: ${err.message}`);
    } finally {
      inFlightDetectsRef.current = Math.max(0, inFlightDetectsRef.current - 1);
    }
  }, [log, speak]);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) {
      requestPermission();
      return;
    }
    // One-time welcome, once camera permission is granted. Slight delay so the
    // camera + audio session have time to settle before the TTS plays.
    if (!welcomeSpokenRef.current) {
      welcomeSpokenRef.current = true;
      const t = setTimeout(() => {
        speak(
          "Detection started. Swipe up to find an item. Swipe down to build a list. Tap to speak a command."
        );
      }, 700);
      // Don't return cleanup that clears t — we want the welcome to fire even
      // if the interval-setup re-runs.
    }
    const ms = findingTarget ? DETECT_INTERVAL_FINDING_MS : DETECT_INTERVAL_MS;
    const interval = setInterval(tick, ms);
    return () => clearInterval(interval);
  }, [permission?.granted, tick, findingTarget, speak]);

  // ----- Gestures: tap to talk, swipe up = find, swipe down = list -----
  const tapGesture = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => {
      if (!isRecording) handleTapToTalk();
    });

  const flingUpGesture = Gesture.Fling()
    .direction(Directions.UP)
    .runOnJS(true)
    .onStart(() => {
      if (findingTargetRef.current) {
        log("cmd", "swipe ↑: stop find");
        stopFinding(true);
      } else {
        log("cmd", "swipe ↑: find");
        startFinding();
      }
    });

  const flingDownGesture = Gesture.Fling()
    .direction(Directions.DOWN)
    .runOnJS(true)
    .onStart(() => {
      if (voiceModeRef.current === "listing") {
        log("cmd", "swipe ↓: end list");
        exitListingMode();
      } else {
        log("cmd", "swipe ↓: build list");
        listingItemsRef.current = [];
        setVoiceMode("listing");
        speak(
          "Building list. Tap to record each item. Swipe down to save when done."
        );
      }
    });

  const screenGesture = Gesture.Race(
    flingUpGesture,
    flingDownGesture,
    tapGesture
  );

  // ----- Render -----
  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          Camera permission is required to detect items.
        </Text>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant permission</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {cameraVisible ? (
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      ) : (
        <View style={[styles.camera, styles.cameraOff]}>
          <Ionicons name="mic" size={64} color="#fff" />
          <Text style={styles.cameraOffText}>Listening…</Text>
        </View>
      )}
      <GestureDetector gesture={screenGesture}>
        <View
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={
            isRecording
              ? "Recording"
              : "Tap to speak. Swipe up for find. Swipe down for list."
          }
          accessibilityHint="Tap records a voice command. Swipe up toggles find mode. Swipe down builds or saves a list."
        />
      </GestureDetector>
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <View style={styles.statusBadgeWrap}>
            {voiceMode === "listing" && (
              <View style={[styles.statusBadge, styles.listingBadge]}>
                <Text style={styles.statusBadgeText}>LIST</Text>
              </View>
            )}
            {findingTarget && (
              <View style={[styles.statusBadge, styles.findingBadge]}>
                <Text style={styles.statusBadgeText}>
                  FIND: {findingTarget.name}
                </Text>
              </View>
            )}
            {isRecording ? (
              <View style={[styles.statusBadge, styles.recordBadge]}>
                <Ionicons name="mic" size={14} color="#fff" />
                <Text style={styles.statusBadgeText}>LISTENING</Text>
              </View>
            ) : (
              <View style={[styles.statusBadge, styles.idleBadge]}>
                <Ionicons name="hand-left" size={14} color="#fff" />
                <Text style={styles.statusBadgeText}>TAP TO TALK</Text>
              </View>
            )}
          </View>
          <View style={styles.topRight}>
            {isRecording && (
              <View style={styles.meter}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      height: `${meterPct(meterDb)}%`,
                      backgroundColor: meterColor(meterDb),
                    },
                  ]}
                />
              </View>
            )}
            <Pressable
              style={styles.exitButton}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Stop detection and return home"
              hitSlop={12}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
          </View>
        </View>
        <View style={styles.bottomPanel}>
          <Text style={styles.status} accessibilityLiveRegion="polite">
            {status}
          </Text>
          {heard ? (
            <Text style={styles.heard} accessibilityLiveRegion="polite">
              {heard}
            </Text>
          ) : null}
          {matches.map((m, i) => (
            <Text key={`${m.matchedFor}:${i}`} style={styles.match}>
              {m.name} → {m.matchedFor} ({m.position.horizontal},{" "}
              {m.position.distance})
            </Text>
          ))}
          {logs.length > 0 && (
            <View style={styles.logsBox}>
              {logs.slice(-7).map((line, i) => (
                <Text key={i} style={styles.logLine} numberOfLines={1}>
                  {line}
                </Text>
              ))}
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  cameraOff: {
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraOffText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 12,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 16,
  },
  statusBadgeWrap: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    flex: 1,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  listingBadge: { backgroundColor: "#3b82f6" },
  findingBadge: { backgroundColor: "#f59e0b" },
  recordBadge: { backgroundColor: "#dc2626" },
  idleBadge: { backgroundColor: "rgba(0,0,0,0.6)" },
  statusBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  exitButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  meter: {
    width: 12,
    height: 44,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  meterFill: {
    width: "100%",
  },
  bottomPanel: {
    padding: 16,
    paddingBottom: 24,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  status: {
    color: "#bbb",
    fontSize: 12,
    fontFamily: "monospace",
    marginBottom: 4,
  },
  heard: {
    color: "#9cf",
    fontSize: 14,
    fontStyle: "italic",
    marginBottom: 6,
  },
  match: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  logsBox: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.15)",
  },
  logLine: {
    color: "#9c9",
    fontSize: 10,
    fontFamily: "monospace",
    lineHeight: 13,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  permissionText: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: "#fff",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginBottom: 12,
    minWidth: 200,
    alignItems: "center",
  },
  primaryButtonText: { color: "#000", fontSize: 16, fontWeight: "600" },
  secondaryButton: { paddingVertical: 12, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#999", fontSize: 14 },
});
