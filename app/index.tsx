import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import {
  Directions,
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Home() {
  const router = useRouter();

  const goToDetector = () => router.push("/detector");

  const swipeUp = Gesture.Fling()
    .direction(Directions.UP)
    .runOnJS(true)
    .onStart(() => goToDetector());

  return (
    <GestureDetector gesture={swipeUp}>
      <SafeAreaView
        style={styles.safe}
        edges={["top", "left", "right", "bottom"]}
      >
        <View style={styles.container}>
          <View style={styles.topBar}>
            <Pressable
              style={({ pressed }) => [
                styles.listsButton,
                pressed && styles.listsButtonPressed,
              ]}
              onPress={() => router.push("/lists")}
              accessibilityRole="button"
              accessibilityLabel="Open lists"
              accessibilityHint="Go to your grocery lists and account"
              hitSlop={12}
            >
              <Ionicons name="list" size={28} color="#fff" />
            </Pressable>
          </View>
          <Pressable
            style={styles.center}
            onPress={goToDetector}
            accessibilityRole="button"
            accessibilityLabel="Start detection"
            accessibilityHint="Swipe up or double tap to begin detecting items with the camera"
          >
            <Ionicons name="arrow-up" size={220} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#000",
  },
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  listsButton: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  listsButtonPressed: {
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
