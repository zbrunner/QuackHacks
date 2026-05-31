import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useFocusEffect } from "@react-navigation/native";

import { AuthScreen } from "@/components/auth-screen";
import { useAuth } from "@/hooks/use-auth";
import { logOut } from "@/src/services/authService";
import { getMyConnections } from "@/src/services/connectionService";
import {
  addPairListItem,
  addPersonalListItem,
  deletePairListItem,
  deletePersonalListItem,
  getPairListItems,
  getPersonalListItems,
} from "@/src/services/listService";
import { getUserProfile } from "@/src/services/userService";

type Connection = {
  id: string;
  displayName?: string;
  email?: string;
};

type ListItem = {
  id: string;
  text?: string;
  addedBy?: string;
};

type ListView = "personal" | "shared";

export default function ListsScreen() {
  const { user, loading: authLoading } = useAuth();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [listView, setListView] = useState<ListView>("personal");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [personalItems, setPersonalItems] = useState<ListItem[]>([]);
  const [sharedItems, setSharedItems] = useState<ListItem[]>([]);
  const [itemText, setItemText] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const personalLoadId = useRef(0);
  const sharedLoadId = useRef(0);

  const myUid = user?.uid ?? null;

  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId]
  );

  const visibleItems = listView === "personal" ? personalItems : sharedItems;

  const listTitle = useMemo(() => {
    if (listView === "personal") return "My personal list";
    if (!selectedConnection) return "Shared list";
    return `Shared list with ${selectedConnection.displayName || selectedConnection.email}`;
  }, [listView, selectedConnection]);

  const loadConnections = useCallback(async () => {
    if (!myUid) return;
    const data = await getMyConnections(myUid);
    setConnections(data as Connection[]);
    if (data.length > 0) {
      setSelectedConnectionId((current) => current ?? data[0].id);
    }
  }, [myUid]);

  const loadPersonalItems = useCallback(async () => {
    if (!myUid) return;

    const requestId = ++personalLoadId.current;
    try {
      const data = await getPersonalListItems(myUid);
      if (requestId === personalLoadId.current) {
        setPersonalItems(data as ListItem[]);
      }
    } catch (error) {
      if (requestId === personalLoadId.current) {
        setStatus(error instanceof Error ? error.message : "Failed to load personal list");
      }
    }
  }, [myUid]);

  const loadSharedItems = useCallback(async () => {
    if (!myUid || !selectedConnectionId) {
      setSharedItems([]);
      return;
    }

    const requestId = ++sharedLoadId.current;
    try {
      const data = await getPairListItems(myUid, selectedConnectionId);
      if (requestId === sharedLoadId.current) {
        setSharedItems(data as ListItem[]);
      }
    } catch (error) {
      if (requestId === sharedLoadId.current) {
        setStatus(error instanceof Error ? error.message : "Failed to load shared list");
      }
    }
  }, [myUid, selectedConnectionId]);

  useEffect(() => {
    if (myUid) {
      getUserProfile(myUid)
        .then((profile) => setDisplayName(profile?.displayName || profile?.email || "Me"))
        .catch(() => setDisplayName("Me"));
    }
  }, [myUid]);

  useFocusEffect(
    useCallback(() => {
      if (myUid) {
        loadConnections().catch((error) => {
          setStatus(error instanceof Error ? error.message : "Failed to load connections");
        });
        loadPersonalItems();
        loadSharedItems();
      }
    }, [myUid, loadConnections, loadPersonalItems, loadSharedItems])
  );

  useEffect(() => {
    loadPersonalItems();
  }, [loadPersonalItems]);

  useEffect(() => {
    loadSharedItems();
  }, [loadSharedItems]);

  function switchToPersonal() {
    setListView("personal");
    setItemText("");
    setStatus("");
  }

  function switchToShared() {
    setListView("shared");
    setItemText("");
    setStatus("");
  }

  async function handleAddItem() {
    if (!user || !myUid || !itemText.trim()) return;

    const mode = listView;
    const connectionId = selectedConnectionId;
    const text = itemText.trim();

    if (mode === "shared" && !connectionId) return;

    setBusy(true);
    setStatus("");
    try {
      if (mode === "personal") {
        await addPersonalListItem(myUid, user.uid, text);
        await loadPersonalItems();
      } else {
        await addPairListItem(myUid, connectionId!, user.uid, text);
        await loadSharedItems();
      }
      setItemText("");
      setStatus(mode === "personal" ? "Added to personal list!" : "Added to shared list!");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add item");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!myUid) return;

    const mode = listView;
    const connectionId = selectedConnectionId;

    if (mode === "shared" && !connectionId) return;

    setBusy(true);
    setStatus("");
    try {
      if (mode === "personal") {
        await deletePersonalListItem(myUid, itemId);
        await loadPersonalItems();
      } else {
        await deletePairListItem(myUid, connectionId!, itemId);
        await loadSharedItems();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to delete item");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    if (listView === "personal") {
      await loadPersonalItems();
    } else {
      await loadSharedItems();
    }
  }

  async function handleLogOut() {
    setBusy(true);
    try {
      await logOut();
      setPersonalItems([]);
      setSharedItems([]);
      setConnections([]);
      setSelectedConnectionId(null);
      setStatus("Logged out");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Logout failed");
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

  const canAddSharedItem = listView === "shared" && connections.length > 0 && selectedConnectionId;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>QuackHacks Lists</Text>
        <Text style={styles.subtitle}>Personal lists + shared lists with connections</Text>

        {status !== "" && <Text style={styles.status}>{status}</Text>}

        {!user ? (
          <AuthScreen onStatus={setStatus} />
        ) : (
          <>
            <View style={styles.section}>
              <View style={styles.row}>
                <Text style={styles.meta}>Signed in as {displayName}</Text>
                <Pressable onPress={handleLogOut} disabled={busy}>
                  <Text style={styles.link}>Log out</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>List type</Text>
              <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggle, listView === "personal" && styles.toggleActive]}
                  onPress={switchToPersonal}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      listView === "personal" && styles.toggleTextActive,
                    ]}
                  >
                    Personal
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.toggle, listView === "shared" && styles.toggleActive]}
                  onPress={switchToShared}
                >
                  <Text
                    style={[styles.toggleText, listView === "shared" && styles.toggleTextActive]}
                  >
                    Shared
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>
                {listView === "personal"
                  ? "Only you can see and edit this list."
                  : "One list per connection — both people see the same items."}
              </Text>
            </View>

            {listView === "shared" && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Share with</Text>
                {connections.map((connection) => (
                  <Pressable
                    key={connection.id}
                    style={[
                      styles.ownerChip,
                      selectedConnectionId === connection.id && styles.ownerChipActive,
                    ]}
                    onPress={() => {
                      setSelectedConnectionId(connection.id);
                      setItemText("");
                      setStatus("");
                    }}
                  >
                    <Text
                      style={[
                        styles.ownerChipText,
                        selectedConnectionId === connection.id && styles.ownerChipTextActive,
                      ]}
                    >
                      {connection.displayName || connection.email}
                    </Text>
                  </Pressable>
                ))}
                {connections.length === 0 && (
                  <Text style={styles.hint}>
                    No connections yet — add people on the Connections tab.
                  </Text>
                )}
              </View>
            )}

            <View style={styles.section}>
              <View style={styles.row}>
                <Text style={styles.sectionTitle}>{listTitle}</Text>
                <Pressable onPress={handleRefresh} disabled={busy}>
                  <Text style={styles.link}>Refresh</Text>
                </Pressable>
              </View>

              {(listView === "personal" || canAddSharedItem) && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder={
                      listView === "personal" ? "Add a personal item..." : "Add a shared item..."
                    }
                    value={itemText}
                    onChangeText={setItemText}
                  />
                  <Pressable
                    style={[styles.button, busy && styles.buttonDisabled]}
                    onPress={handleAddItem}
                    disabled={busy || !itemText.trim()}
                  >
                    <Text style={styles.buttonText}>
                      {listView === "personal" ? "Add to Personal" : "Add to Shared"}
                    </Text>
                  </Pressable>
                </>
              )}

              <FlatList
                key={`${listView}-${selectedConnectionId ?? "personal"}`}
                data={visibleItems}
                keyExtractor={(item) => `${listView}-${item.id}`}
                scrollEnabled={false}
                ListEmptyComponent={
                  <Text style={styles.empty}>
                    {listView === "shared" && connections.length === 0
                      ? "Connect with someone to start a shared list."
                      : "No items yet — add one above."}
                  </Text>
                }
                renderItem={({ item }) => (
                  <View style={styles.itemCard}>
                    <View style={styles.itemContent}>
                      <Text style={styles.itemText}>{item.text}</Text>
                      <Text style={styles.itemMeta}>
                        Added by {item.addedBy === user.uid ? "you" : item.addedBy?.slice(0, 8)}
                      </Text>
                    </View>
                    {item.addedBy === user.uid ? (
                      <Pressable onPress={() => handleDeleteItem(item.id)} disabled={busy}>
                        <Text style={styles.deleteLink}>Delete</Text>
                      </Pressable>
                    ) : null}
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
    fontSize: 16,
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
    marginBottom: 24,
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
  meta: {
    fontSize: 14,
    color: "#444",
  },
  hint: {
    fontSize: 13,
    color: "#888",
    marginTop: 8,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 10,
  },
  toggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  toggleActive: {
    backgroundColor: "black",
    borderColor: "black",
  },
  toggleText: {
    fontWeight: "600",
    color: "#333",
  },
  toggleTextActive: {
    color: "white",
  },
  ownerChip: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  ownerChipActive: {
    borderColor: "black",
    backgroundColor: "#f5f5f5",
  },
  ownerChipText: {
    fontSize: 15,
    color: "#333",
  },
  ownerChipTextActive: {
    fontWeight: "700",
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
    marginBottom: 16,
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
  deleteLink: {
    color: "#cc0000",
    fontWeight: "600",
    fontSize: 13,
  },
  empty: {
    color: "#888",
    fontStyle: "italic",
  },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  itemContent: {
    flex: 1,
  },
  itemText: {
    fontSize: 16,
    marginBottom: 4,
  },
  itemMeta: {
    fontSize: 12,
    color: "#888",
  },
});
