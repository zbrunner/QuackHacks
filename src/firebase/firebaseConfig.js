import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyAsCUG8rPYTXeG8Zi0iQG73hBohQW8gnXc",
  authDomain: "uoo-quackathon26eug-8212.firebaseapp.com",
  projectId: "uoo-quackathon26eug-8212",
  storageBucket: "uoo-quackathon26eug-8212.firebasestorage.app",
  messagingSenderId: "645092651752",
  appId: "1:645092651752:web:777b30e6c1468bc4378f5d",
};

const app = initializeApp(firebaseConfig);

const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

const db = getFirestore(app);

export { app, auth, db };
