// English — the SOURCE catalogue.
//
// Every other locale is typed against this one, so a missing or misspelled key
// in hi.ts is a compile error rather than a blank label discovered in QA.
//
// Rules:
//   · Keys are grouped by feature, then by screen or concept.
//   · Interpolation uses {name} and is type-checked at the call site.
//   · Never concatenate translated fragments — word order differs in Hindi, and
//     "You sent " + gift + " to " + host produces nonsense in Devanagari.
//     Write the whole sentence with placeholders.

export const en = {
  app: {
    /**
     * The wordmark. A key rather than a literal so a Devanagari mark stays
     * possible, but both catalogues carry the Latin form for now — Indian apps
     * in this category keep their brand in Latin script even in Hindi.
     */
    name: 'Dhun',
  },

  common: {
    continue: 'Continue',
    cancel: 'Cancel',
    retry: 'Retry',
    close: 'Close',
    back: 'Back',
    done: 'Done',
    loading: 'Loading…',
    somethingWentWrong: 'Something went wrong',
    noConnection: 'No internet connection',
    noConnectionBody: 'Check your network and try again.',
    change: 'Change',
    save: 'Save',
    skip: 'Skip',
  },

  tabs: {
    live: 'Live',
    following: 'Following',
    search: 'Search',
    wallet: 'Wallet',
    me: 'Me',
  },

  errors: {
    title: 'Something went wrong',
    body: 'The app hit an unexpected problem. You can try again.',
    reference: 'Reference: {traceId}',
    tryAgain: 'Try again',
    // Shown when a gift animation fails — the room itself must keep working.
    visualFailed: 'Could not play this effect',

    // One sentence per failure the user can act on. Anything not listed here
    // falls through to `unexpected` rather than showing a raw server string.
    network: 'No internet connection. Check your network and try again.',
    timeout: 'That took too long. Try again.',
    rateLimited: 'Too many attempts. Wait a moment and try again.',
    serviceUnavailable: 'Dhun is briefly unavailable. Try again in a minute.',
    unexpected: 'Something went wrong. Try again.',
    banned: 'This account has been suspended.',
    sessionEnded: 'You were signed out. Sign in again to continue.',
  },

  auth: {
    phoneTitle: 'Enter your phone number',
    phoneSubtitle: 'We will send a 6-digit code on WhatsApp.',
    phonePlaceholder: 'Phone number',
    phoneInvalid: 'Enter a valid 10-digit number',
    sendCode: 'Send code',
    continueAsGuest: 'Browse without signing in',

    otpTitle: 'Enter the code',
    otpSubtitle: 'Sent to {phone}',
    otpResend: 'Resend code',
    otpResendIn: 'Resend in {seconds}s',
    otpIncorrect: 'That code is not correct',
    otpAttemptsLeft: '{count} attempt remaining',
    otpAttemptsLeftPlural: '{count} attempts remaining',
    otpExpired: 'That code expired. Request a new one.',
    otpAttemptsExceeded: 'Too many wrong attempts. Request a new code.',
    otpRateLimited: 'Too many codes requested. Try again in a few minutes.',
    otpChangeNumber: 'Wrong number?',
    // Development builds only: the backend returns the code until DLT clears.
    devCode: 'Dev build — your code is {code}',
    // Rendered with {terms} and {privacy} replaced by tappable links, so word
    // order stays correct in Hindi rather than being assembled from fragments.
    legalNotice: 'By continuing you agree to our {terms} and {privacy}.',

    profileTitle: 'Set up your profile',
    displayName: 'Display name',
    dateOfBirth: 'Date of birth',
    // The 18+ gate. Phrased as a requirement, not an accusation.
    mustBeAdult: 'You must be 18 or older to use Dhun',
    dobRequired: 'Add your date of birth to continue',
    profileSubtitle: 'This is how people see you in rooms.',
    displayNamePlaceholder: 'Your name',
    displayNameTooShort: 'Use at least 2 characters',
    dobHelp: 'Checked once, never shown on your profile.',
    dobSelect: 'Select your date of birth',
    genderLabel: 'Gender (optional)',
    genderMale: 'Male',
    genderFemale: 'Female',
    genderOther: 'Other',
    genderUndisclosed: 'Prefer not to say',
    finish: 'Finish',
  },

  me: {
    title: 'Me',
    guest: 'Guest',
    guestBody: 'Verify your number to keep your coins and go live.',
    verifyPhone: 'Verify phone number',
    noPhone: 'No phone number added',
    editProfile: 'Edit profile',
    account: 'Account',
    preferences: 'Preferences',
    language: 'Language',
    legalSection: 'Legal',
    signOut: 'Sign out',
    signOutTitle: 'Sign out of Dhun?',
    signOutBody: 'You can sign back in with the same number.',
  },

  wallet: {
    title: 'Wallet',
    coins: 'Coins',
    gems: 'Gems',
    coinsHint: 'Send gifts to hosts',
    gemsHint: 'Buy frames, effects and more',
    buyCoins: 'Buy coins',
    convert: 'Convert to gems',
    convertBonus: 'Get {percent}% extra',
    transactions: 'Transactions',
    level: 'Level {level}',
    insufficientCoins: 'Not enough coins',
    insufficientGems: 'Not enough gems',
    purchaseSuccess: 'Added {coins} coins and {gems} gems',
  },

  gifting: {
    send: 'Send',
    sentGift: 'You sent {gift} to {host}',
    // Whole sentence with placeholders — never assembled from fragments.
    someoneSentGift: '{sender} sent {gift} to {host}',
    combo: 'x{count}',
  },

  room: {
    live: 'LIVE',
    viewers: '{count} watching',
    joinFailed: 'Could not join this room',
    ended: 'This stream has ended',
  },

  legal: {
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    guidelines: 'Community Guidelines',
    grievance: 'Grievance Officer',
  },
} as const;

/**
 * The catalogue SHAPE: same keys, but every leaf relaxed to `string`.
 *
 * Without this, `as const` above would make each value a literal type and Hindi
 * would be required to equal the English text — every translated line an error.
 * Keys stay exactly required, which is the part that matters.
 */
type Localised<T> = {
  [K in keyof T]: T[K] extends string ? string : Localised<T[K]>;
};

export type Messages = Localised<typeof en>;
