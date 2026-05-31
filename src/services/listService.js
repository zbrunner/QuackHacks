import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../firebase/firebaseConfig";

export const LIST_TYPES = {
  personal: "personalList",
};

export function getPairId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

async function ensurePairList(uid1, uid2) {
  const pairId = getPairId(uid1, uid2);
  const pairRef = doc(db, "pairLists", pairId);
  const snapshot = await getDoc(pairRef);

  if (!snapshot.exists()) {
    await setDoc(pairRef, {
      members: [uid1, uid2].sort(),
      createdAt: serverTimestamp(),
    });
  }

  return pairId;
}

export async function addPersonalListItem(ownerId, addedBy, text) {
  return addDoc(collection(db, "users", ownerId, LIST_TYPES.personal), {
    text: text.trim(),
    addedBy,
    listKind: "personal",
    createdAt: serverTimestamp(),
  });
}

export async function getPersonalListItems(ownerId) {
  const q = query(
    collection(db, "users", ownerId, LIST_TYPES.personal),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((itemDoc) => ({
    id: itemDoc.id,
    ...itemDoc.data(),
  }));
}

export async function deletePersonalListItem(ownerId, itemId) {
  return deleteDoc(doc(db, "users", ownerId, LIST_TYPES.personal, itemId));
}

export async function addPairListItem(myUid, connectionUid, addedBy, text) {
  const pairId = await ensurePairList(myUid, connectionUid);
  return addDoc(collection(db, "pairLists", pairId, "items"), {
    text: text.trim(),
    addedBy,
    listKind: "shared",
    createdAt: serverTimestamp(),
  });
}

export async function getPairListItems(myUid, connectionUid) {
  const pairId = await ensurePairList(myUid, connectionUid);

  const q = query(
    collection(db, "pairLists", pairId, "items"),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((itemDoc) => ({
    id: itemDoc.id,
    ...itemDoc.data(),
  }));
}

export async function deletePairListItem(myUid, connectionUid, itemId) {
  const pairId = getPairId(myUid, connectionUid);
  return deleteDoc(doc(db, "pairLists", pairId, "items", itemId));
}
