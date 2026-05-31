import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export async function createUserProfile(userId, email, displayName = "") {
  return await setDoc(doc(db, "users", userId), {
    email: normalizeEmail(email),
    displayName,
    createdAt: serverTimestamp(),
  });
}

export async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  let q = query(collection(db, "users"), where("email", "==", normalized), limit(1));
  let snapshot = await getDocs(q);

  if (snapshot.empty && normalized !== email.trim()) {
    q = query(collection(db, "users"), where("email", "==", email.trim()), limit(1));
    snapshot = await getDocs(q);
  }

  if (snapshot.empty) {
    return null;
  }

  const userDoc = snapshot.docs[0];
  return {
    id: userDoc.id,
    ...userDoc.data(),
  };
}

export async function getUserProfile(userId) {
  const snapshot = await getDoc(doc(db, "users", userId));

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}
