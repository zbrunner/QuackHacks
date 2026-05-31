import {
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signOut,
} from "firebase/auth";

import { auth } from "../firebase/firebaseConfig";

export async function signUp(email, password) {
  return await createUserWithEmailAndPassword(auth, email, password);
}

export async function logIn(email, password) {
  return await signInWithEmailAndPassword(auth, email, password);
}

export async function logOut() {
  return await signOut(auth);
}

export async function resetPassword(email) {
  return await sendPasswordResetEmail(auth, email.trim());
}
