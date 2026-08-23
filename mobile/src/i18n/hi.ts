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
  app: {
    name: 'Dhun',
  },

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
    change: 'बदलें',
    save: 'सेव करें',
    skip: 'अभी नहीं',
  },

  tabs: {
    live: 'लाइव',
    following: 'फ़ॉलोइंग',
    search: 'खोजें',
    wallet: 'वॉलेट',
    me: 'प्रोफ़ाइल',
  },

  errors: {
    title: 'कुछ गड़बड़ हो गई',
    body: 'ऐप में एक अनपेक्षित समस्या आ गई। आप दोबारा कोशिश कर सकते हैं।',
    reference: 'रेफ़रेंस: {traceId}',
    tryAgain: 'दोबारा कोशिश करें',
    visualFailed: 'यह इफ़ेक्ट नहीं चल सका',
    network: 'इंटरनेट कनेक्शन नहीं है। अपना नेटवर्क जाँचें और दोबारा कोशिश करें।',
    timeout: 'बहुत ज़्यादा समय लग गया। दोबारा कोशिश करें।',
    rateLimited: 'बहुत ज़्यादा कोशिशें हो गईं। थोड़ी देर बाद दोबारा कोशिश करें।',
    serviceUnavailable: 'Dhun थोड़ी देर के लिए उपलब्ध नहीं है। एक मिनट बाद कोशिश करें।',
    unexpected: 'कुछ गड़बड़ हो गई। दोबारा कोशिश करें।',
    banned: 'यह अकाउंट निलंबित कर दिया गया है।',
    sessionEnded: 'आप साइन आउट हो गए हैं। आगे बढ़ने के लिए दोबारा साइन इन करें।',
  },

  auth: {
    phoneTitle: 'अपना फ़ोन नंबर डालें',
    phoneSubtitle: 'हम WhatsApp पर 6 अंकों का कोड भेजेंगे।',
    phonePlaceholder: 'फ़ोन नंबर',
    phoneInvalid: '10 अंकों का सही नंबर डालें',
    sendCode: 'कोड भेजें',
    continueAsGuest: 'बिना साइन इन के देखें',

    otpTitle: 'कोड डालें',
    otpSubtitle: '{phone} पर भेजा गया',
    otpResend: 'कोड दोबारा भेजें',
    otpResendIn: '{seconds} सेकंड में दोबारा भेजें',
    otpIncorrect: 'यह कोड सही नहीं है',
    otpAttemptsLeft: '{count} कोशिश बाकी',
    otpAttemptsLeftPlural: '{count} कोशिशें बाकी',
    otpExpired: 'कोड की समय-सीमा खत्म हो गई। नया कोड मँगवाएँ।',
    otpAttemptsExceeded: 'बहुत ज़्यादा गलत कोशिशें। नया कोड मँगवाएँ।',
    otpRateLimited: 'बहुत ज़्यादा कोड मँगवाए गए। कुछ मिनट बाद कोशिश करें।',
    otpChangeNumber: 'नंबर गलत है?',
    devCode: 'डेव बिल्ड — आपका कोड {code} है',
    legalNotice: 'आगे बढ़ने पर आप हमारी {terms} और {privacy} से सहमत होते हैं।',

    profileTitle: 'अपनी प्रोफ़ाइल बनाएँ',
    displayName: 'नाम',
    dateOfBirth: 'जन्म तिथि',
    mustBeAdult: 'Dhun इस्तेमाल करने के लिए आपकी उम्र 18 साल या उससे ज़्यादा होनी चाहिए',
    dobRequired: 'आगे बढ़ने के लिए अपनी जन्म तिथि डालें',
    profileSubtitle: 'रूम में लोग आपको ऐसे देखेंगे।',
    displayNamePlaceholder: 'आपका नाम',
    displayNameTooShort: 'कम से कम 2 अक्षर डालें',
    dobHelp: 'सिर्फ़ एक बार जाँचा जाता है, प्रोफ़ाइल पर कभी नहीं दिखता।',
    dobSelect: 'अपनी जन्म तिथि चुनें',
    genderLabel: 'लिंग (ज़रूरी नहीं)',
    genderMale: 'पुरुष',
    genderFemale: 'महिला',
    genderOther: 'अन्य',
    genderUndisclosed: 'बताना नहीं चाहते',
    finish: 'पूरा करें',
  },

  me: {
    title: 'प्रोफ़ाइल',
    guest: 'गेस्ट',
    guestBody: 'अपने कॉइन बचाने और लाइव जाने के लिए नंबर वेरिफ़ाई करें।',
    verifyPhone: 'फ़ोन नंबर वेरिफ़ाई करें',
    noPhone: 'कोई फ़ोन नंबर नहीं जोड़ा गया',
    editProfile: 'प्रोफ़ाइल बदलें',
    account: 'अकाउंट',
    preferences: 'सेटिंग',
    language: 'भाषा',
    legalSection: 'कानूनी',
    signOut: 'साइन आउट',
    signOutTitle: 'Dhun से साइन आउट करें?',
    signOutBody: 'आप उसी नंबर से दोबारा साइन इन कर सकते हैं।',
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
