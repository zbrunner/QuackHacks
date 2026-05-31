import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AuthScreen } from "@/components/auth-screen";
import { useAuth } from "@/hooks/use-auth";
import {
  acceptConnection,
  declineConnection,
  getIncomingRequests,
  getMyConnections,
  sendConnectionRequest,
} from "@/src/services/connectionService";
import { findUserByEmail, getUserProfile } from "@/src/services/userService";

type Connection = {
  id: string;
  displayName?: string;
  email?: string;
};

type IncomingRequest = {
  id: string;
  fromEmail?: string;
  fromDisplayName?: string;
};

export default function ConnectionsScreen() {
  const { user, loading: authLoading } = useAuth();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [myProfile, setMyProfile] = useState<{ email: string; displayName: string } | null>(
    null
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;

    const [connectionList, requestList, profile] = await Promise.all([
      getMyConnections(user.uid),
      getIncomingRequests(user.uid),
      getUserProfile(user.uid),
    ]);

    setConnections(connectionList as Connection[]);
    setIncoming(requestList as IncomingRequest[]);

    if (profile) {
      setMyProfile({
        email: profile.email,
        displayName: profile.displayName || profile.email,
      });
    }
  }, [user]);

  useEffect(() => {
    loadData().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Failed to load connections");
    });
  }, [loadData]);

  async function handleSendRequest() {
    if (!user || !myProfile) return;

    setBusy(true);
    setStatus("");
    try {
      const target = await findUserByEmail(inviteEmail);
      if (!target) {
        throw new Error("No user found with that email");
      }

      await sendConnectionRequest(user.uid, target.id, myProfile, {
        email: target.email,
        displayName: target.displayName || target.email,
      });

      setInviteEmail("");
      setStatus(`Request sent to ${target.email}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to send request");
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(theirId: string) {
    if (!user || !myProfile) return;

    setBusy(true);
    setStatus("");
    try {
      const theirProfile = await getUserProfile(theirId);
      if (!theirProfile) {
        throw new Error("User profile not found");
      }

      await acceptConnection(user.uid, theirId, myProfile, {
        email: theirProfile.email,
        displayName: theirProfile.displayName || theirProfile.email,
      });

      await loadData();
      setStatus("Connection accepted!");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to accept");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline(theirId: string) {
    if (!user) return;

    setBusy(true);
    setStatus("");
    try {
      await declineConnection(user.uid, theirId);
      await loadData();
      setStatus("Request declined");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to decline");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Connections</Text>
        <Text style={styles.subtitle}>
          Connect with others to share lists. Connections are not transitive.
        </Text>

        {status !== "" && <Text style={styles.status}>{status}</Text>}

        {!user ? (
          <AuthScreen onStatus={setStatus} />
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Add connection</Text>
              <Text style={styles.hint}>
                Enter the email of someone who already signed up.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="friend@email.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={inviteEmail}
                onChangeText={setInviteEmail}
              />
              <Pressable
                style={[styles.button, busy && styles.buttonDisabled]}
                onPress={handleSendRequest}
                disabled={busy || !inviteEmail.trim()}
              >
                <Text style={styles.buttonText}>Send Request</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Incoming requests</Text>
              <FlatList
                data={incoming}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                ListEmptyComponent={
                  <Text style={styles.empty}>No pending requests.</Text>
                }
                renderItem={({ item }) => (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>
                      {item.fromDisplayName || item.fromEmail}
                    </Text>
                    <Text style={styles.cardMeta}>{item.fromEmail}</Text>
                    <View style={styles.cardActions}>
                      <Pressable
                        style={styles.acceptButton}
                        onPress={() => handleAccept(item.id)}
                        disabled={busy}
                      >
                        <Text style={styles.acceptText}>Accept</Text>
                      </Pressable>
                      <Pressable
                        style={styles.declineButton}
                        onPress={() => handleDecline(item.id)}
                        disabled={busy}
                      >
                        <Text style={styles.declineText}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              />
            </View>

            <View style={styles.section}>
              <View style={styles.row}>
                <Text style={styles.sectionTitle}>Your connections</Text>
                <Pressable onPress={loadData} disabled={busy}>
                  <Text style={styles.link}>Refresh</Text>
                </Pressable>
              </View>
              <FlatList
                data={connections}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                ListEmptyComponent={
                  <Text style={styles.empty}>No connections yet.</Text>
                }
                renderItem={({ item }) => (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{item.displayName || item.email}</Text>
                    <Text style={styles.cardMeta}>{item.email}</Text>
                  </View>
                )}
              />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "white",
  },
  container: {
    padding: 24,
    paddingBottom: 48,
    backgroundColor: "white",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    color: "#666",
    marginBottom: 24,
  },
  status: {
    backgroundColor: "#f0f0f0",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 14,
    color: "#333",
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  hint: {
    fontSize: 13,
    color: "#888",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "black",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  link: {
    color: "#0066cc",
    fontWeight: "600",
  },
  empty: {
    color: "#888",
    fontStyle: "italic",
  },
  card: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
    color: "#888",
    marginBottom: 8,
  },
  cardActions: {
    flexDirection: "row",
    gap: 10,
  },
  acceptButton: {
    backgroundColor: "black",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  acceptText: {
    color: "white",
    fontWeight: "600",
  },
  declineButton: {
    borderWidth: 1,
    borderColor: "#ccc",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  declineText: {
    color: "#333",
    fontWeight: "600",
  },
});
