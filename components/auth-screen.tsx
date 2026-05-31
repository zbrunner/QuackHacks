import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { logIn, resetPassword, signUp } from "@/src/services/authService";
import { createUserProfile } from "@/src/services/userService";

type AuthScreenProps = {
  onStatus?: (message: string) => void;
};

type AuthMode = "login" | "reset";

export function AuthScreen({ onStatus }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSignUp() {
    setBusy(true);
    try {
      const result = await signUp(email.trim(), password);
      await createUserProfile(result.user.uid, email.trim());
      onStatus?.("Account created!");
      setPassword("");
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogIn() {
    setBusy(true);
    try {
      await logIn(email.trim(), password);
      onStatus?.("Logged in!");
      setPassword("");
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword() {
    setBusy(true);
    try {
      await resetPassword(email);
      onStatus?.("Reset link sent! Check your email to set a new password.");
      setMode("login");
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Failed to send reset email");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "reset") {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reset password</Text>
        <Text style={styles.hint}>
          Enter your email and we&apos;ll send you a link to choose a new password.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={handleResetPassword}
          disabled={busy || !email.trim()}
        >
          <Text style={styles.buttonText}>Send Reset Link</Text>
        </Pressable>
        <Pressable
          style={styles.linkButton}
          onPress={() => setMode("login")}
          disabled={busy}
        >
          <Text style={styles.linkText}>Back to log in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Sign in to QuackHacks</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={styles.linkButton} onPress={() => setMode("reset")} disabled={busy}>
        <Text style={styles.linkText}>Forgot password?</Text>
      </Pressable>
      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={handleSignUp}
        disabled={busy || !email || !password}
      >
        <Text style={styles.buttonText}>Sign Up</Text>
      </Pressable>
      <Pressable
        style={[styles.buttonSecondary, busy && styles.buttonDisabled]}
        onPress={handleLogIn}
        disabled={busy || !email || !password}
      >
        <Text style={styles.buttonSecondaryText}>Log In</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  hint: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
    lineHeight: 20,
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
    marginBottom: 10,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: "black",
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
  buttonSecondaryText: {
    color: "black",
    fontWeight: "bold",
    fontSize: 16,
  },
  linkButton: {
    alignSelf: "flex-end",
    marginBottom: 16,
    paddingVertical: 4,
  },
  linkText: {
    color: "#0066cc",
    fontWeight: "600",
    fontSize: 14,
  },
});
