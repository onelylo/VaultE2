import React, { useState, useRef, useMemo } from 'react';

const FLAG_COUNTRY_MAP: Record<string, string> = {
  '🇺🇸': 'United States (US)', '🇬🇧': 'United Kingdom (GB)', '🇫🇷': 'France (FR)', '🇩🇪': 'Germany (DE)', '🇮🇹': 'Italy (IT)', '🇪🇸': 'Spain (ES)', '🇯🇵': 'Japan (JP)', '🇰🇷': 'South Korea (KR)', '🇨🇳': 'China (CN)', '🇷🇺': 'Russia (RU)', '🇧🇷': 'Brazil (BR)', '🇮🇳': 'India (IN)', '🇦🇺': 'Australia (AU)', '🇨🇦': 'Canada (CA)', '🇲🇽': 'Mexico (MX)', '🇦🇷': 'Argentina (AR)', '🇿🇦': 'South Africa (ZA)', '🇳🇬': 'Nigeria (NG)', '🇪🇬': 'Egypt (EG)', '🇹🇷': 'Turkey (TR)', '🇸🇦': 'Saudi Arabia (SA)', '🇦🇪': 'UAE (AE)', '🇮🇱': 'Israel (IL)', '🇵🇰': 'Pakistan (PK)', '🇧🇩': 'Bangladesh (BD)', '🇻🇳': 'Vietnam (VN)', '🇹🇭': 'Thailand (TH)', '🇮🇩': 'Indonesia (ID)', '🇲🇾': 'Malaysia (MY)', '🇵🇭': 'Philippines (PH)', '🇸🇬': 'Singapore (SG)', '🇳🇿': 'New Zealand (NZ)', '🇭🇰': 'Hong Kong (HK)', '🇹🇼': 'Taiwan (TW)', '🇺🇦': 'Ukraine (UA)', '🇵🇱': 'Poland (PL)', '🇳🇱': 'Netherlands (NL)', '🇧🇪': 'Belgium (BE)', '🇨🇭': 'Switzerland (CH)', '🇦🇹': 'Austria (AT)', '🇸🇪': 'Sweden (SE)', '🇳🇴': 'Norway (NO)', '🇩🇰': 'Denmark (DK)', '🇫🇮': 'Finland (FI)', '🇮🇪': 'Ireland (IE)', '🇵🇹': 'Portugal (PT)', '🇬🇷': 'Greece (GR)', '🇨🇿': 'Czechia (CZ)', '🇷🇴': 'Romania (RO)', '🇭🇺': 'Hungary (HU)', '🇧🇬': 'Bulgaria (BG)', '🇷🇸': 'Serbia (RS)', '🇭🇷': 'Croatia (HR)', '🇸🇮': 'Slovenia (SI)', '🇧🇦': 'Bosnia (BA)', '🇲🇰': 'North Macedonia (MK)', '🇦🇱': 'Albania (AL)', '🇲🇪': 'Montenegro (ME)', '🇽🇰': 'Kosovo (XK)', '🇱🇺': 'Luxembourg (LU)', '🇮🇸': 'Iceland (IS)', '🇪🇪': 'Estonia (EE)', '🇱🇻': 'Latvia (LV)', '🇱🇹': 'Lithuania (LT)', '🇧🇾': 'Belarus (BY)', '🇲🇩': 'Moldova (MD)', '🇬🇪': 'Georgia (GE)', '🇦🇲': 'Armenia (AM)', '🇦🇿': 'Azerbaijan (AZ)', '🇰🇿': 'Kazakhstan (KZ)', '🇺🇿': 'Uzbekistan (UZ)', '🇹🇲': 'Turkmenistan (TM)', '🇰🇬': 'Kyrgyzstan (KG)', '🇹🇯': 'Tajikistan (TJ)', '🇦🇫': 'Afghanistan (AF)', '🇮🇷': 'Iran (IR)', '🇮🇶': 'Iraq (IQ)', '🇸🇾': 'Syria (SY)', '🇱🇧': 'Lebanon (LB)', '🇯🇴': 'Jordan (JO)', '🇵🇸': 'Palestine (PS)', '🇾🇪': 'Yemen (YE)', '🇴🇲': 'Oman (OM)', '🇶🇦': 'Qatar (QA)', '🇧🇭': 'Bahrain (BH)', '🇰🇼': 'Kuwait (KW)',
  '🏁': 'Checkered Flag', '🚩': 'Triangular Flag', '🎌': 'Crossed Flags', '🏴': 'Black Flag', '🏳️': 'White Flag', '🏳️‍🌈': 'Rainbow Flag', '🏳️‍⚧️': 'Transgender Flag', '🏴‍☠️': 'Pirate Flag',
};

// Convert flag emoji to ISO country code (e.g., 🇺🇸 -> 'us')
function flagEmojiToCountryCode(emoji: string): string | null {
  // Regional indicator symbols range: U+1F1E6 to U+1F1FF (A-Z)
  // Flag emoji is two regional indicators
  const codePoints = [...emoji].map(c => c.codePointAt(0) || 0);
  if (codePoints.length === 2 && codePoints[0] >= 0x1F1E6 && codePoints[0] <= 0x1F1FF && codePoints[1] >= 0x1F1E6 && codePoints[1] <= 0x1F1FF) {
    const first = String.fromCharCode(codePoints[0] - 0x1F1E6 + 65).toLowerCase();
    const second = String.fromCharCode(codePoints[1] - 0x1F1E6 + 65).toLowerCase();
    return first + second;
  }
  // Special cases
  const specialFlags: Record<string, string> = {
    '🏳️‍🌈': 'rainbow',
    '🏳️‍⚧️': 'transgender',
    '🏴‍☠️': 'pirate',
    '🏁': 'checkered',
    '🚩': 'triangular',
    '🎌': 'crossed',
    '🏴': 'black',
    '🏳️': 'white',
  };
  return specialFlags[emoji] || null;
}

// Render flag as SVG image (works on all platforms including Windows)
function FlagIcon({ emoji, size = 24 }: { emoji: string; size?: number }) {
  const countryCode = flagEmojiToCountryCode(emoji);
  if (!countryCode) return <span style={EMOJI_STYLE}>{emoji}</span>;
  
  // Special non-country flags
  const specialFlags: Record<string, string> = {
    'rainbow': 'https://raw.githubusercontent.com/hampusborgos/country-flags/main/svg/non/rainbow-flag.svg',
    'transgender': 'https://raw.githubusercontent.com/hampusborgos/country-flags/main/svg/non/transgender-flag.svg',
    'pirate': 'https://raw.githubusercontent.com/hampusborgos/country-flags/main/svg/non/jolly-roger.svg',
    'checkered': 'https://raw.githubusercontent.com/hampusborgos/country-flags/main/svg/non/checkered-flag.svg',
    'triangular': 'https://raw.githubusercontent.com/hampusborgos/country-flags/main/svg/non/triangular-flag.svg',
    'crossed': 'https://raw.githubusercontent.com/hampusborgos/country-flags/main/svg/non/crossed-flags.svg',
    'black': 'https://raw.githubusercontent.com/hampusborgos/country-flags/main/svg/non/black-flag.svg',
    'white': 'https://raw.githubusercontent.com/hampusborgos/country-flags/main/svg/non/white-flag.svg',
  };
  
  const url = specialFlags[countryCode] 
    ? specialFlags[countryCode]
    : `https://flagcdn.com/w${size * 2}/${countryCode}.png`; // Use PNG for better compatibility
  
  return (
    <img
      src={url}
      alt={FLAG_COUNTRY_MAP[emoji] || emoji}
      title={FLAG_COUNTRY_MAP[emoji] || emoji}
      style={{
        width: size,
        height: size,
        borderRadius: '2px',
        objectFit: 'cover',
      }}
    />
  );
}

function isFlagEmoji(emoji: string): boolean {
  return FLAG_COUNTRY_MAP.hasOwnProperty(emoji);
}

const EMOJI_STYLE: React.CSSProperties = {
  fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", "Android Emoji", sans-serif',
  fontSize: '1.5rem',
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const EMOJI_BUTTON_STYLE: React.CSSProperties = {
  width: '32px',
  height: '32px',
  minWidth: '32px',
  minHeight: '32px',
};

const EMOJI_CATEGORIES: Record<string, { label: string; emojis: string[] }> = {
  'Smileys': {
    label: '😀 Smileys',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴','😵','🤯','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  },
  'Gestures': {
    label: '👋 Gestures',
    emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄'],
  },
  'People': {
    label: '👤 People',
    emojis: ['👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂','🥷','👷','🫅','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🫃','🫄','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧜‍♂️','🧜‍♀️','🧝','🧞','🧟','🧟‍♂️','🧟‍♀️','💆','💇','🚶','🧍','🧎','🏃','💃','🕺','👯','🧖','🧗','🏇','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪'],
  },
  'Animals': {
    label: '🐶 Animals',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦣','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🐾','🐉','🐲','🦕','🦖'],
  },
  'Food': {
    label: '🍔 Food',
    emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂'],
  },
  'Activities': {
    label: '⚽ Activities',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','🎯','🪃','🪅','🪆','♠️','♥️','♦️','♣️','♟️','🃏','🀄','🎴','🎭','🖼️','🎨','🧵','🪡','🧶','🪢','🎈','🎉','🎊','🎋','🎍','🎎','🎏','🎐','🎑','🧧','🎀','🎁','🎗️','🎟️','🎫','🎖️','🏆','🏅','🥇','🥈','🥉','🏆','🎮','🕹️','🎲','🧩','🧸','🪅','🪩','🪆','♠️','♥️','♦️','♣️','♟️','🃏','🀄','🎴','🎭','🖼️','🎨'],
  },
  'Travel': {
    label: '🚗 Travel',
    emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','🚍','🚘','🚖','🛩️','✈️','🛫','🛬','🪂','💺','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','🛖','🏠','🏡','🏘️','🏚️','🏗️','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛️','⛪','🕌','🛕','🕍','⛩️','🕋','🛕','🗽','🗿','🗼','🏰','🏯','🏟️','🎪','🎭','🖼️','🎨','🧵','🪡','🧶','🪢'],
  },
  'Objects': {
    label: '💡 Objects',
    emojis: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔩','⚙️','🗜️','⛏️','🛠️','⚒️','🔨','🪚','🔗','⛓️','🪝','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','💊','💉','🩸','🧬','🧫','🧪','🌡️','🧹','🪠','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🪥','🪒','🧽','🪣','🧴','🛎️','🔑','🗝️','🚪','🪑','🛋️','🛏️','🛌','🧸','🪆','🖼️','🪞','🪟','🛍️','🛒','🎁','🎈','🎏','🪅','🪩','🎉','🎊','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','🪧','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📖','📗','📘','📙','📚','🏷️','💬','👁️‍🗨️','🗨️','🗯️','💭','💤'],
  },
  'Symbols': {
    label: '💚 Symbols',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧️','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','🟰','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🀄','🎴','🔏','🔐','🔒','🔓'],
  },
  'Flags': {
    label: '🏁 Flags',
    emojis: ['🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️','🇺🇸','🇬🇧','🇫🇷','🇩🇪','🇮🇹','🇪🇸','🇯🇵','🇰🇷','🇨🇳','🇷🇺','🇧🇷','🇮🇳','🇦🇺','🇨🇦','🇲🇽','🇦🇷','🇿🇦','🇳🇬','🇪🇬','🇹🇷','🇸🇦','🇦🇪','🇮🇱','🇵🇰','🇧🇩','🇻🇳','🇹🇭','🇮🇩','🇲🇾','🇵🇭','🇸🇬','🇳🇿','🇭🇰','🇹🇼','🇺🇦','🇵🇱','🇳🇱','🇧🇪','🇨🇭','🇦🇹','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇮🇪','🇵🇹','🇬🇷','🇨🇿','🇷🇴','🇭🇺','🇧🇬','🇷🇸','🇭🇷','🇸🇮','🇧🇦','🇲🇰','🇦🇱','🇲🇪','🇽🇰','🇱🇺','🇮🇸','🇪🇪','🇱🇻','🇱🇹','🇧🇾','🇲🇩','🇬🇪','🇦🇲','🇦🇿','🇰🇿','🇺🇿','🇹🇲','🇰🇬','🇹🇯','🇦🇫','🇮🇷','🇮🇶','🇸🇾','🇱🇧','🇯🇴','🇵🇸','🇾🇪','🇴🇲','🇶🇦','🇧🇭','🇰🇼'],
  },
};

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  isOpen: boolean;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, isOpen }) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Smileys');
  const ref = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Click-outside is handled by ChatArea via data-emoji-btn / data-emoji-picker attributes.
  // No local handler needed — avoids race with the toggle button's onClick.

  const filteredEmojis = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    const results: string[] = [];
    for (const cat of Object.values(EMOJI_CATEGORIES)) {
      for (const emoji of cat.emojis) {
        if (emoji.toLowerCase().includes(q)) results.push(emoji);
      }
    }
    return results;
  }, [search]);

  if (!isOpen) return null;

  const categoryKeys = Object.keys(EMOJI_CATEGORIES);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-80 rounded-xl shadow-2xl z-50 animate-scaleIn flex flex-col"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        maxHeight: '360px',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Search */}
      <div className="p-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search emoji..."
          className="w-full px-3 py-1.5 text-xs rounded-lg focus:outline-none"
          style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
          autoFocus
        />
      </div>

      {/* Category tabs */}
      {!search && (
        <div className="flex gap-0.5 px-2 py-1 border-b overflow-x-auto" style={{ borderColor: 'var(--border-color)' }}>
          {categoryKeys.map(key => (
            <button
              key={key}
              onClick={() => {
                setActiveCategory(key);
                categoryRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="px-2 py-1 text-[10px] font-bold rounded whitespace-nowrap transition-smooth"
              style={{
                backgroundColor: activeCategory === key ? 'var(--accent-primary)' : 'transparent',
                color: activeCategory === key ? 'var(--accent-text)' : 'var(--text-muted)',
              }}
            >
              {EMOJI_CATEGORIES[key].label.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: '260px' }}>
        {filteredEmojis ? (
          <div className="grid grid-cols-8 gap-0.5">
            {filteredEmojis.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                onClick={() => { onSelect(emoji); setSearch(''); }}
                className="flex items-center justify-center rounded-lg transition-smooth hover:scale-125"
                style={EMOJI_BUTTON_STYLE}
                title={isFlagEmoji(emoji) ? FLAG_COUNTRY_MAP[emoji] : ''}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {isFlagEmoji(emoji) ? <FlagIcon emoji={emoji} size={24} /> : <span style={EMOJI_STYLE}>{emoji}</span>}
              </button>
            ))}
          </div>
        ) : (
          categoryKeys.map(key => (
            <div
              key={key}
              ref={el => { categoryRefs.current[key] = el; }}
              className="mb-2"
            >
              <div className="text-[10px] font-bold mb-1 sticky top-0 px-1 py-0.5" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)' }}>
                {EMOJI_CATEGORIES[key].label}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {EMOJI_CATEGORIES[key].emojis.map((emoji, i) => (
                  <button
                    key={`${emoji}-${i}`}
                    onClick={() => { onSelect(emoji); setSearch(''); }}
                    className="flex items-center justify-center rounded-lg transition-smooth hover:scale-125"
                    style={EMOJI_BUTTON_STYLE}
                    title={isFlagEmoji(emoji) ? FLAG_COUNTRY_MAP[emoji] : ''}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    {isFlagEmoji(emoji) ? <FlagIcon emoji={emoji} size={24} /> : <span style={EMOJI_STYLE}>{emoji}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
