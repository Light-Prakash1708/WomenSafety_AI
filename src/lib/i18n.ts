// Core strings in English, Hindi and Bengali. Anything not listed falls back to English.
export type Lang = "en" | "hi" | "bn";

const en = {
  hello: "Hi, {name}",
  ready: "You're set. Your circle is one press away.",
  notReady: "Add at least one trusted contact so SOS can reach someone.",
  circleReady: "Circle ready",
  circleCount: "{n} people",
  holdSos: "hold 2 sec",
  sosHint: "Or shake your phone hard 3 times while SAAHI is open",
  sosHintWeb: "Press and hold with your mouse, finger or the space bar",
  walk: "Walk with me",
  walkSub: "Check-ins on your route",
  log: "Log something",
  logSub: "Add to your pattern",
  ghost: "Ghost call",
  ghostSub: "A believable call in 5 sec",
  support: "Get support",
  supportSub: "Private, at your pace",
  quickExit: "Quick exit",
  helpOnWay: "Help is on the way",
  imSafe: "I'm safe",
  call112: "Call 112",
  enterPin: "Enter PIN to cancel",
  cancelled: "Alert cancelled",
  tabHome: "Home",
  tabPattern: "Pattern",
  tabWalk: "Walk",
  tabVault: "Vault",
  tabSupport: "Support",
  sosSms: "SOS from {name} via SAAHI. I need help. Live location: {link}",
  sosSmsNoLink: "SOS from {name} via SAAHI. I need help. My location: {maps}",
};

type Dict = typeof en;

const hi: Partial<Dict> = {
  hello: "नमस्ते, {name}",
  ready: "सब तैयार है। आपका सर्कल बस एक दबाव दूर है।",
  notReady: "कम से कम एक भरोसेमंद संपर्क जोड़ें ताकि SOS किसी तक पहुँच सके।",
  circleReady: "सर्कल तैयार",
  circleCount: "{n} लोग",
  holdSos: "2 सेकंड दबाएँ",
  sosHint: "या SAAHI खुला हो तो फ़ोन को 3 बार ज़ोर से हिलाएँ",
  sosHintWeb: "माउस, उंगली या स्पेस बार से दबाकर रखें",
  walk: "मेरे साथ चलो",
  walkSub: "रास्ते में चेक-इन",
  log: "कुछ दर्ज करें",
  logSub: "अपने पैटर्न में जोड़ें",
  ghost: "नकली कॉल",
  ghostSub: "5 सेकंड में असली जैसी कॉल",
  support: "मदद पाएँ",
  supportSub: "निजी, आपकी गति से",
  quickExit: "तुरंत बाहर",
  helpOnWay: "मदद आ रही है",
  imSafe: "मैं सुरक्षित हूँ",
  call112: "112 पर कॉल करें",
  enterPin: "रद्द करने के लिए PIN डालें",
  cancelled: "अलर्ट रद्द",
  tabHome: "होम",
  tabPattern: "पैटर्न",
  tabWalk: "चलो",
  tabVault: "वॉल्ट",
  tabSupport: "मदद",
  sosSms: "SAAHI से {name} का SOS। मुझे मदद चाहिए। लाइव लोकेशन: {link}",
  sosSmsNoLink: "SAAHI से {name} का SOS। मुझे मदद चाहिए। मेरी लोकेशन: {maps}",
};

const bn: Partial<Dict> = {
  hello: "নমস্কার, {name}",
  ready: "সব তৈরি। আপনার সার্কেল এক চাপ দূরে।",
  notReady: "অন্তত একজন বিশ্বস্ত পরিচিতি যোগ করুন যাতে SOS কারও কাছে পৌঁছায়।",
  circleReady: "সার্কেল তৈরি",
  circleCount: "{n} জন",
  holdSos: "২ সেকেন্ড চেপে ধরুন",
  sosHint: "অথবা SAAHI খোলা থাকলে ফোন ৩ বার জোরে ঝাঁকান",
  sosHintWeb: "মাউস, আঙুল বা স্পেস বার দিয়ে চেপে ধরুন",
  walk: "আমার সাথে হাঁটো",
  walkSub: "পথে চেক-ইন",
  log: "কিছু লিখে রাখুন",
  logSub: "আপনার প্যাটার্নে যোগ করুন",
  ghost: "নকল কল",
  ghostSub: "৫ সেকেন্ডে বিশ্বাসযোগ্য কল",
  support: "সাহায্য নিন",
  supportSub: "গোপনে, আপনার গতিতে",
  quickExit: "দ্রুত বেরোন",
  helpOnWay: "সাহায্য আসছে",
  imSafe: "আমি নিরাপদ",
  call112: "112-এ কল করুন",
  enterPin: "বাতিল করতে PIN দিন",
  cancelled: "অ্যালার্ট বাতিল",
  tabHome: "হোম",
  tabPattern: "প্যাটার্ন",
  tabWalk: "হাঁটা",
  tabVault: "ভল্ট",
  tabSupport: "সাহায্য",
  sosSms: "SAAHI থেকে {name}-এর SOS। আমার সাহায্য দরকার। লাইভ লোকেশন: {link}",
  sosSmsNoLink: "SAAHI থেকে {name}-এর SOS। আমার সাহায্য দরকার। আমার লোকেশন: {maps}",
};

const dicts: Record<Lang, Partial<Dict>> = { en, hi, bn };

export type Key = keyof Dict;

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s = (dicts[lang]?.[key] ?? en[key]) as string;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
