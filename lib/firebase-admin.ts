import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "jdt-command-board";
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET ||
  "jdt-command-board.firebasestorage.app";

const adminApp =
  getApps()[0] ||
  initializeApp({
    credential: applicationDefault(),
    projectId,
    storageBucket,
  });

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(
  adminApp,
  process.env.FIRESTORE_DATABASE_ID || "(default)",
);
export const adminBucket = getStorage(adminApp).bucket(storageBucket);

