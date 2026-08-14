import React from 'react';

export const EMOJI_STYLE: React.CSSProperties = {
  fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", "Android Emoji", sans-serif',
  fontSize: '1.5rem',
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export const EMOJI_BUTTON_STYLE: React.CSSProperties = {
  width: '32px',
  height: '32px',
  minWidth: '32px',
  minHeight: '32px',
};

export const FLAG_COUNTRY_MAP: Record<string, string> = {
  '🇺🇸': 'United States (US)', '🇬🇧': 'United Kingdom (GB)', '🇫🇷': 'France (FR)', '🇩🇪': 'Germany (DE)', '🇮🇹': 'Italy (IT)', '🇪🇸': 'Spain (ES)', '🇯🇵': 'Japan (JP)', '🇰🇷': 'South Korea (KR)', '🇨🇳': 'China (CN)', '🇷🇺': 'Russia (RU)', '🇧🇷': 'Brazil (BR)', '🇮🇳': 'India (IN)', '🇦🇺': 'Australia (AU)', '🇨🇦': 'Canada (CA)', '🇲🇽': 'Mexico (MX)', '🇦🇷': 'Argentina (AR)', '🇿🇦': 'South Africa (ZA)', '🇳🇬': 'Nigeria (NG)', '🇪🇬': 'Egypt (EG)', '🇹🇷': 'Turkey (TR)', '🇸🇦': 'Saudi Arabia (SA)', '🇦🇪': 'UAE (AE)', '🇮🇱': 'Israel (IL)', '🇵🇰': 'Pakistan (PK)', '🇧🇩': 'Bangladesh (BD)', '🇻🇳': 'Vietnam (VN)', '🇹🇭': 'Thailand (TH)', '🇮🇩': 'Indonesia (ID)', '🇲🇾': 'Malaysia (MY)', '🇵🇭': 'Philippines (PH)', '🇸🇬': 'Singapore (SG)', '🇳🇿': 'New Zealand (NZ)', '🇭🇰': 'Hong Kong (HK)', '🇹🇼': 'Taiwan (TW)', '🇺🇦': 'Ukraine (UA)', '🇵🇱': 'Poland (PL)', '🇳🇱': 'Netherlands (NL)', '🇧🇪': 'Belgium (BE)', '🇨🇭': 'Switzerland (CH)', '🇦🇹': 'Austria (AT)', '🇸🇪': 'Sweden (SE)', '🇳🇴': 'Norway (NO)', '🇩🇰': 'Denmark (DK)', '🇫🇮': 'Finland (FI)', '🇮🇪': 'Ireland (IE)', '🇵🇹': 'Portugal (PT)', '🇬🇷': 'Greece (GR)', '🇨🇿': 'Czechia (CZ)', '🇷🇴': 'Romania (RO)', '🇭🇺': 'Hungary (HU)', '🇧🇬': 'Bulgaria (BG)', '🇷🇸': 'Serbia (RS)', '🇭🇷': 'Croatia (HR)', '🇸🇮': 'Slovenia (SI)', '🇧🇦': 'Bosnia (BA)', '🇲🇰': 'North Macedonia (MK)', '🇦🇱': 'Albania (AL)', '🇲🇪': 'Montenegro (ME)', '🇽🇰': 'Kosovo (XK)', '🇱🇺': 'Luxembourg (LU)', '🇮🇸': 'Iceland (IS)', '🇪🇪': 'Estonia (EE)', '🇱🇻': 'Latvia (LV)', '🇱🇹': 'Lithuania (LT)', '🇧🇾': 'Belarus (BY)', '🇲🇩': 'Moldova (MD)', '🇬🇪': 'Georgia (GE)', '🇦🇲': 'Armenia (AM)', '🇦🇿': 'Azerbaijan (AZ)', '🇰🇿': 'Kazakhstan (KZ)', '🇺🇿': 'Uzbekistan (UZ)', '🇹🇲': 'Turkmenistan (TM)', '🇰🇬': 'Kyrgyzstan (KG)', '🇹🇯': 'Tajikistan (TJ)', '🇦🇫': 'Afghanistan (AF)', '🇮🇷': 'Iran (IR)', '🇮🇶': 'Iraq (IQ)', '🇸🇾': 'Syria (SY)', '🇱🇧': 'Lebanon (LB)', '🇯🇴': 'Jordan (JO)', '🇵🇸': 'Palestine (PS)', '🇾🇪': 'Yemen (YE)', '🇴🇲': 'Oman (OM)', '🇶🇦': 'Qatar (QA)', '🇧🇭': 'Bahrain (BH)', '🇰🇼': 'Kuwait (KW)',
  '🏁': 'Checkered Flag', '🚩': 'Triangular Flag', '🎌': 'Crossed Flags', '🏴': 'Black Flag', '🏳️': 'White Flag', '🏳️‍🌈': 'Rainbow Flag', '🏳️‍⚧️': 'Transgender Flag', '🏴‍☠️': 'Pirate Flag',
};

export function isFlagEmoji(emoji: string): boolean {
  return FLAG_COUNTRY_MAP.hasOwnProperty(emoji);
}

export function flagEmojiToCountryCode(emoji: string): string | null {
  const codePoints = [...emoji].map(c => c.codePointAt(0) || 0);
  if (codePoints.length === 2 && codePoints[0] >= 0x1F1E6 && codePoints[0] <= 0x1F1FF && codePoints[1] >= 0x1F1E6 && codePoints[1] <= 0x1F1FF) {
    const first = String.fromCharCode(codePoints[0] - 0x1F1E6 + 65).toLowerCase();
    const second = String.fromCharCode(codePoints[1] - 0x1F1E6 + 65).toLowerCase();
    return first + second;
  }
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

function FlagIconInner({ emoji, size = 24 }: { emoji: string; size?: number }) {
  const countryCode = flagEmojiToCountryCode(emoji);
  if (!countryCode) return <span style={EMOJI_STYLE}>{emoji}</span>;

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
    : `https://flagcdn.com/w${size * 2}/${countryCode}.png`;

  return (
    <img
      src={url}
      alt={FLAG_COUNTRY_MAP[emoji] || emoji}
      title={FLAG_COUNTRY_MAP[emoji] || emoji}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
      onLoad={(e) => { e.currentTarget.style.display = 'inline'; }}
      style={{
        width: size,
        height: size,
        borderRadius: '2px',
        objectFit: 'cover',
        verticalAlign: 'middle',
      }}
    />
  );
}

export function FlagIcon({ emoji, size = 24 }: { emoji: string; size?: number }) {
  return <FlagIconInner emoji={emoji} size={size} />;
}

export function renderEmojiText(text: string): React.ReactNode {
  return <span style={EMOJI_STYLE}>{text}</span>;
}

export function EmojiSpan({ emoji, size = 24 }: { emoji: string; size?: number }) {
  return isFlagEmoji(emoji) ? <FlagIconInner emoji={emoji} size={size} /> : <span style={{ ...EMOJI_STYLE, fontSize: `${size * 0.8}px` }}>{emoji}</span>;
}