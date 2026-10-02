import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface FirebaseConfig {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain: string;
}

export function getFirebaseConfig(): FirebaseConfig {
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY,
    } as FirebaseConfig;
  }
  const filePath = resolve(
    process.env.FIREBASE_CREDENTIALS_PATH || 'config/firebase.json',
  );

  if (!existsSync(filePath)) {
    throw new Error('Firebase configuration file not found.');
  }

  const config = JSON.parse(readFileSync(filePath, 'utf8')) as FirebaseConfig;
  return config;
}
