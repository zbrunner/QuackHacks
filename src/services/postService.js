import {
    addDoc,
    collection,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebase/firebaseConfig";

export async function createPost(userId, caption) {
  return await addDoc(collection(db, "posts"), {
    userId,
    caption,
    createdAt: serverTimestamp(),
    likesCount: 0,
  });
}

export async function getPosts() {
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}
