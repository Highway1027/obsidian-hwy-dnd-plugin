// src/firebase.ts
// v1 - 25-02-2026 - Firebase SDK integration for Initiative Bridge

import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut as firebaseSignOut, Auth, User } from 'firebase/auth';
import {
    getFirestore, Firestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    collection, query, where, orderBy, limit, onSnapshot, arrayUnion, arrayRemove,
    runTransaction, serverTimestamp, deleteField, Unsubscribe
} from 'firebase/firestore';
import { requestUrl } from 'obsidian';

// Firebase config — same project as the webapp. These are public client-side keys.
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCLaGp-SKOqyfmGCPmDfpAiCpMJ4ULs5Xs',
    authDomain: 'wildshape-tracker.firebaseapp.com',
    projectId: 'wildshape-tracker',
    storageBucket: 'wildshape-tracker.firebasestorage.app',
    messagingSenderId: '755528324780',
    appId: '1:755528324780:web:f3d4ee32ecca5effc1defc'
};

const CLOUD_FUNCTION_REGION = 'europe-west1';
const PROJECT_ID = FIREBASE_CONFIG.projectId;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let currentUser: User | null = null;

/**
 * Initialize the Firebase SDK (idempotent — safe to call multiple times).
 */
export function initFirebase(): { auth: Auth; db: Firestore } {
    if (!app) {
        app = initializeApp(FIREBASE_CONFIG, 'hwy-dnd-bridge');
        auth = getAuth(app);
        db = getFirestore(app);
    }
    return { auth: auth!, db: db! };
}

/**
 * Exchange the user's API token for a Firebase custom auth token
 * by calling the obsidianExchangeToken Cloud Function, then sign in.
 */
export async function authenticateWithApiToken(apiToken: string): Promise<User> {
    const { auth: fbAuth } = initFirebase();

    // Call the token exchange Cloud Function
    const url = `https://${CLOUD_FUNCTION_REGION}-${PROJECT_ID}.cloudfunctions.net/obsidianExchangeToken`;

    const response = await requestUrl({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiToken })
    });

    const { customToken } = response.json;
    if (!customToken) {
        throw new Error('Failed to obtain authentication token.');
    }

    // Sign in with the custom token
    const credential = await signInWithCustomToken(fbAuth, customToken);
    currentUser = credential.user;
    return currentUser;
}

/**
 * Check if the Firebase SDK is authenticated.
 */
export function isAuthenticated(): boolean {
    return currentUser !== null;
}

/**
 * Get the currently signed-in user.
 */
export function getCurrentUser(): User | null {
    return currentUser;
}

/**
 * Sign out and clean up the Firebase session.
 */
export async function signOutFirebase(): Promise<void> {
    if (auth) {
        await firebaseSignOut(auth);
        currentUser = null;
    }
}

/**
 * Get the Firestore instance (must be initialized first via initFirebase).
 */
export function getDb(): Firestore {
    if (!db) {
        initFirebase();
    }
    return db!;
}

/**
 * Get the Cloud Function base URL for direct REST calls.
 */
export function getCloudFunctionUrl(functionName: string): string {
    return `https://${CLOUD_FUNCTION_REGION}-${PROJECT_ID}.cloudfunctions.net/${functionName}`;
}

// Re-export Firestore utilities for convenience
export {
    doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    collection, query, where, orderBy, limit, onSnapshot,
    arrayUnion, arrayRemove, runTransaction, serverTimestamp, deleteField
};
export type { Unsubscribe };
