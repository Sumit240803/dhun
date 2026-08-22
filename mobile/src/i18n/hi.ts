// Hindi.
//
// Typed against `Messages`, so a missing or misspelled key fails the build. That
// is the whole reason this is hand-rolled instead of a string-keyed library.
//
// Written in Devanagari rather than romanised Hinglish. Romanised text reads as
// informal and slightly foreign in an interface, even to users who type that way
// in chat — and the source docs are Hinglish only because they are internal.
//
// Note the sentence-level placeholders: Hindi is subject-object-verb, so a string
// assembled as "You sent " + gift + " to " + host cannot be reordered correctly.
// Whole sentences with named placeholders are the only thing that survives.

import type { Messages } from './en';

export const hi: Messages = {
  common: {
    continue: 'आगे बढ़ें',
    cancel: 'रद्द करें',
    retry: 'दोबारा कोशिश करें',
    close: 'बंद करें',
    back: 'वापस',
    done: 'हो गया',
    loading: 'लोड हो रहा है…',
    somethingWentWrong: 'कुछ गड़बड़ हो गई',
    noConnection: 'इंटरनेट कनेक्शन नहीं है',
    noConnectionBody: 'अपना नेटवर्क जाँचें और दोबारा कोशिश करें।',
  },

  errors: {
    title: 'कुछ गड़बड़ हो गई',
    body: 'ऐप में एक अनपेक्षित समस्या आ गई। आप दोबारा कोशिश कर सकते हैं।',
    reference: 'रेफ़रेंस: {traceId}',
    tryAgain: 'दोबारा कोशिश करें',
    visualFailed: 'यह इफ़ेक्ट नहीं चल सका',
  },

  auth: {
    phoneTitle: 'अपना फ़ोन नंबर डालें',
    phoneSubtitle: 'हम आपको एक वेरिफ़िकेशन कोड भेजेंगे',
    phonePlaceholder: 'फ़ोन नंबर',
    phoneInvalid: '10 अंकों का सही नंबर डालें',
    sendCode: 'कोड भेजें',

    otpTitle: 'कोड डालें',
    otpSubtitle: '{phone} पर भेजा गया',
    otpResend: 'कोड दोबारा भेजें',
    otpResendIn: '{seconds} सेकंड में दोबारा भेजें',
    otpIncorrect: 'यह कोड सही नहीं है',
    otpAttemptsLeft: '{count} कोशिश बाकी',
    otpAttemptsLeftPlural: '{count} कोशिशें बाकी',
    otpExpired: 'कोड की समय-सीमा खत्म हो गई। नया कोड मँगवाएँ।',

    profileTitle: 'अपनी प्रोफ़ाइल बनाएँ',
    displayName: 'नाम',
    dateOfBirth: 'जन्म तिथि',
    mustBeAdult: 'Dhun इस्तेमाल करने के लिए आपकी उम्र 18 साल या उससे ज़्यादा होनी चाहिए',
    dobRequired: 'आगे बढ़ने के लिए अपनी जन्म तिथि डालें',
  },

  wallet: {
    title: 'वॉलेट',
    coins: 'कॉइन',
    gems: 'जेम',
    coinsHint: 'होस्ट को गिफ़्ट भेजें',
    gemsHint: 'फ़्रेम, इफ़ेक्ट और बहुत कुछ खरीदें',
    buyCoins: 'कॉइन खरीदें',
    convert: 'जेम में बदलें',
    convertBonus: '{percent}% ज़्यादा पाएँ',
    transactions: 'लेन-देन',
    level: 'लेवल {level}',
    insufficientCoins: 'कॉइन कम हैं',
    insufficientGems: 'जेम कम हैं',
    purchaseSuccess: '{coins} कॉइन और {gems} जेम जुड़ गए',
  },

  gifting: {
    send: 'भेजें',
    sentGift: 'आपने {host} को {gift} भेजा',
    someoneSentGift: '{sender} ने {host} को {gift} भेजा',
    combo: 'x{count}',
  },

  room: {
    live: 'लाइव',
    viewers: '{count} देख रहे हैं',
    joinFailed: 'इस रूम में नहीं जा सके',
    ended: 'यह स्ट्रीम खत्म हो गई',
  },

  legal: {
    privacy: 'प्राइवेसी पॉलिसी',
    terms: 'सेवा की शर्तें',
    guidelines: 'कम्युनिटी गाइडलाइन्स',
    grievance: 'शिकायत अधिकारी',
  },
};
