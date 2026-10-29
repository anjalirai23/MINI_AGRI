import { useLanguage } from "../context/LanguageContext";

const LANGS = [
  { code: "en", label: "EN" },
  { code: "hi", label: "हिं" },
  { code: "pa", label: "ਪੰ" },
  { code: "bn", label: "বাং" },
];

export default function LanguageSwitch({ className = "" }) {
  const { lang, setLang } = useLanguage();
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          className={lang === l.code ? "active" : ""}
          onClick={() => setLang(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
