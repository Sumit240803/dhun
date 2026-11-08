# Android push: Firebase setup

How to give Dhun working Android push notifications. Do it once, about 20 minutes, then
make a new dev build.

## How push works here

The backend never talks to Firebase. It sends every notification to **Expo's push
service**, and Expo forwards it to Firebase Cloud Messaging (FCM), which delivers it to the
phone. That is why there are two Firebase files, and they go to different places.

| File | What it is | Where it goes | Secret? |
|---|---|---|---|
| `google-services.json` | Tells the app which Firebase project it belongs to | Into the **app build**, through an EAS file variable | Low risk, but the repo is public, so it is never committed |
| FCM V1 service-account key (`…-firebase-adminsdk-….json`) | Lets its holder send pushes to every Dhun user | Uploaded to **Expo** (EAS credentials), and nowhere else | **Yes.** Never in the repo, never in the backend `.env`, never in chat |

## 1 · Create the Firebase project

Use the company Google account, not a personal one. Whoever owns the account owns the
push channel to every user.

1. Open <https://console.firebase.google.com> and choose **Create a project**.
2. Name it **Dhun**.
3. **Turn Google Analytics off.** Dhun has its own analytics (migration 039). Analytics
   here would send user data to Google that the privacy policy does not cover.
4. Choose **Create project**.

## 2 · Register the Android app and download `google-services.json`

1. On the project's home page, choose the **Android** icon (**Add app**).
2. **Android package name:** `com.dhunlive.dhun`. It must match exactly. It is the one
   string that can never change after the first Play Store upload.
3. **App nickname:** `Dhun Android`.
4. **Debug signing certificate SHA-1:** leave it empty. Push does not need it. Google
   sign-in will need it later, and it can be added then.
5. Choose **Register app**, then **Download google-services.json**.
6. Skip the remaining wizard steps about Gradle and the Firebase SDK. Expo's config plugin
   does all of that during the build.

Before going on, open the downloaded file and check that `package_name` says
`com.dhunlive.dhun`.

## 3 · Put the file in the project

1. Move it to `mobile/google-services.json`.
2. Confirm git ignores it. The command must print a line naming `.gitignore`:
   ```bash
   git check-ignore -v mobile/google-services.json
   ```
   If it prints nothing, stop. Do not commit the file.

`mobile/app.config.ts` picks the file up for local builds and `expo prebuild`.

## 4 · Give it to EAS builds

EAS uploads the project the way git sees it, so an ignored file never reaches the build
machine. It travels as a **file variable** instead. `app.config.ts` reads the variable,
and each build profile in `eas.json` names the environment it uses.

From `mobile/`:

```bash
eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json \
  --environment development --environment preview --environment production \
  --visibility secret
```

Check it is there:

```bash
eas env:list development
```

To replace the file later, run the same command with `--force`.

## 5 · Give Expo the FCM V1 key

This is what lets Expo's push service deliver through Firebase. Without it the app gets a
push token, and every send fails with `InvalidCredentials`.

1. In Firebase, choose the **gear** › **Project settings** › **Service accounts**.
2. Choose **Generate new private key** › **Generate key**. A JSON file downloads.
3. Upload it to Expo. Either way works:
   - **Dashboard:** <https://expo.dev> › project **dhun** › **Credentials** › **Android** ›
     `com.dhunlive.dhun` › **FCM V1 service account key** › **Add a service account
     key** › upload the JSON.
   - **CLI**, from `mobile/`: `eas credentials -p android` › pick any profile › **Google
     Service Account** › **Manage your Google Service Account Key for Push Notifications
     (FCM V1)** › **Set up a Google Service Account Key for Push Notifications (FCM V1)** ›
     **Upload a new service account key**.
4. **Delete the downloaded key from your computer.** Expo holds it now. If you want a
   spare copy, keep it in a password manager, never in a folder or a chat.

The key belongs to the Android app, not a build profile, so one upload covers
development, preview and production builds.

If the key ever leaks: in Google Cloud console › IAM › Service accounts, delete that key,
generate a new one, and upload the new one to Expo.

## 6 · Switch the backend to real pushes

The backend logs pushes to the console by default. In `backend/.env`:

```bash
PUSH_PROVIDER=expo
```

Staging and production already set `PUSH_PROVIDER=expo` in Terraform
(`infra/envs/*/main.tf`).

**Recommended before launch:** in the Expo dashboard, turn on **Enhanced security for push
notifications** (project › Settings). After that, Expo accepts a send only with an access
token, so a leaked push token is useless to anyone else. Create a token under account
settings › **Access tokens**, then set `EXPO_ACCESS_TOKEN` in
`infra/secrets/<env>.tfvars`, run `terraform apply` and `infra/scripts/sync-env.sh`
(infra/README.md § Rotate a secret). Never put it in the app. Do not turn this on until
the token is in the backend's env, or every push will be refused.

## 7 · Make a new dev build

`google-services.json` is native configuration, so an OTA update cannot deliver it. Only
a new build can.

```bash
cd mobile
eas build --profile development --platform android
```

In the build log, the **Read app config** step should show `googleServicesFile` set to a
path under the build's working directory. If it is missing, the variable is not in the
`development` environment. Check step 4.

## 8 · Test it

1. Install the new build. Start the API (`npm run dev`) and the gateway
   (`npm run gateway`) in `backend/`, and Metro (`npx expo start --dev-client`) in
   `mobile/`.
2. Sign in, open a host's profile and follow them. The first follow asks for
   notification permission. Allow it.
3. Check that the token arrived. The backend logs `POST /v1/notifications/token` with
   status 200, and the token starts with `ExponentPushToken[`.
4. **Send a test by hand:** open <https://expo.dev/notifications>, paste the token, and
   send. If it arrives, the whole Firebase and Expo chain works.
5. **Test the real flow:** on a second phone, sign in as the host you followed and go live.
   The first phone should get the "live now" notification within a few seconds. Lock it
   first, because a foreground notification can be easy to miss.

## When it does not work

| Symptom | Cause | Fix |
|---|---|---|
| No permission prompt, and the event log shows `PUSH_REGISTER_FAILED` with "Default FirebaseApp is not initialized" | The build has no `google-services.json` | Step 4, then rebuild |
| Token registered, the expo.dev test send fails with `InvalidCredentials` | No FCM V1 key on Expo | Step 5. No rebuild needed |
| Test send works, the live notification never arrives | Backend still on the console provider, or the follower capped or cooling down | Set `PUSH_PROVIDER=expo` and restart. Check the `push` row in `app_config` |
| Build fails with a package name mismatch | The file was made for another package | Step 2 again with `com.dhunlive.dhun` |
| Sends fail after turning on enhanced security | Backend has no `EXPO_ACCESS_TOKEN` | Step 6 |

## Later

- **iOS** needs an APNs key instead, which EAS creates during the first iOS build. The
  backend needs no change, because Expo's service handles both platforms.
- **Google sign-in** (the OAuth work still open in the build plan) uses this same Firebase
  project. That is when the SHA-1 fingerprints from step 2 get added.
