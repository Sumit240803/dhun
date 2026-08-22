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
  },

  errors: {
    title: 'Something went wrong',
    body: 'The app hit an unexpected problem. You can try again.',
    reference: 'Reference: {traceId}',
    tryAgain: 'Try again',
    // Shown when a gift animation fails — the room itself must keep working.
    visualFailed: 'Could not play this effect',
  },

  auth: {
    phoneTitle: 'Enter your phone number',
    phoneSubtitle: 'We will send you a verification code',
    phonePlaceholder: 'Phone number',
    phoneInvalid: 'Enter a valid 10-digit number',
    sendCode: 'Send code',

    otpTitle: 'Enter the code',
    otpSubtitle: 'Sent to {phone}',
    otpResend: 'Resend code',
    otpResendIn: 'Resend in {seconds}s',
    otpIncorrect: 'That code is not correct',
    otpAttemptsLeft: '{count} attempt remaining',
    otpAttemptsLeftPlural: '{count} attempts remaining',
    otpExpired: 'That code expired. Request a new one.',

    profileTitle: 'Set up your profile',
    displayName: 'Display name',
    dateOfBirth: 'Date of birth',
    // The 18+ gate. Phrased as a requirement, not an accusation.
    mustBeAdult: 'You must be 18 or older to use Dhun',
    dobRequired: 'Add your date of birth to continue',
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
