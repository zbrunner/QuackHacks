import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase/firebaseConfig";
import { getPairId } from "./listService";

export async function sendConnectionRequest(fromId, toId, fromProfile, toProfile) {
  if (fromId === toId) {
    throw new Error("You cannot connect with yourself");
  }

  const existing = await getDoc(doc(db, "users", fromId, "connections", toId));
  if (existing.exists()) {
    throw new Error("You are already connected");
  }

  const pending = await getDoc(doc(db, "users", fromId, "outgoingRequests", toId));
  if (pending.exists()) {
    throw new Error("Connection request already sent");
  }

  const batch = writeBatch(db);

  batch.set(doc(db, "users", toId, "incomingRequests", fromId), {
    fromEmail: fromProfile.email,
    fromDisplayName: fromProfile.displayName || fromProfile.email,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, "users", fromId, "outgoingRequests", toId), {
    toEmail: toProfile.email,
    toDisplayName: toProfile.displayName || toProfile.email,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function getIncomingRequests(userId) {
  const snapshot = await getDocs(collection(db, "users", userId, "incomingRequests"));

  return snapshot.docs.map((requestDoc) => ({
    id: requestDoc.id,
    ...requestDoc.data(),
  }));
}

export async function acceptConnection(myId, theirId, myProfile, theirProfile) {
  const batch = writeBatch(db);

  batch.set(doc(db, "users", myId, "connections", theirId), {
    email: theirProfile.email,
    displayName: theirProfile.displayName || theirProfile.email,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, "users", theirId, "connections", myId), {
    email: myProfile.email,
    displayName: myProfile.displayName || myProfile.email,
    createdAt: serverTimestamp(),
  });

  batch.delete(doc(db, "users", myId, "incomingRequests", theirId));
  batch.delete(doc(db, "users", theirId, "outgoingRequests", myId));

  const pairId = getPairId(myId, theirId);
  batch.set(doc(db, "pairLists", pairId), {
    members: [myId, theirId].sort(),
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function declineConnection(myId, theirId) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", myId, "incomingRequests", theirId));
  batch.delete(doc(db, "users", theirId, "outgoingRequests", myId));
  await batch.commit();
}

export async function getMyConnections(userId) {
  const snapshot = await getDocs(collection(db, "users", userId, "connections"));

  return snapshot.docs.map((connectionDoc) => ({
    id: connectionDoc.id,
    ...connectionDoc.data(),
  }));
}
