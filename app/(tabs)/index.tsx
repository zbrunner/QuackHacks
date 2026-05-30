import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";

export default function HomeScreen() {
  const [message, setMessage] = useState("");

  return (
    <View style={styles.container}>
      <Text style={styles.title}>QuackHacks</Text>
      <Text style={styles.subtitle}>My first React Native app</Text>

      <TextInput
        style={styles.input}
        placeholder="Type something..."
        value={message}
        onChangeText={setMessage}
      />

      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>Submit</Text>
      </Pressable>

      {message !== "" && (
        <Text style={styles.output}>You typed: {message}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: "white",
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: "black",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  output: {
    marginTop: 24,
    fontSize: 18,
    textAlign: "center",
  },
});