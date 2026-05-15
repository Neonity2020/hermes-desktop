import { Bot } from "../../assets/icons";
import claudeLogo from "../../assets/logos/claude-color.svg";
import geminiLogo from "../../assets/logos/gemini-color.svg";
import nousLogo from "../../assets/logos/nousresearch.svg";
import openaiLogo from "../../assets/logos/openai.svg";
import openrouterLogo from "../../assets/logos/openrouter.svg";
import moonshotLogo from "../../assets/logos/moonshot.svg";
import metaLogo from "../../assets/logos/meta-color.svg";
import nvidiaLogo from "../../assets/logos/nvidia-color.svg";

type BrandKey =
  | "claude"
  | "gemini"
  | "nous"
  | "openai"
  | "openrouter"
  | "moonshot"
  | "meta"
  | "nvidia"
  | "unknown";

const LOGOS: Record<Exclude<BrandKey, "unknown">, string> = {
  claude: claudeLogo,
  gemini: geminiLogo,
  nous: nousLogo,
  openai: openaiLogo,
  openrouter: openrouterLogo,
  moonshot: moonshotLogo,
  meta: metaLogo,
  nvidia: nvidiaLogo,
};

function detectBrand(provider?: string, modelId?: string): BrandKey {
  const haystack = `${provider || ""} ${modelId || ""}`.toLowerCase();
  if (/(claude|anthropic)/.test(haystack)) return "claude";
  if (/(gemini|google)/.test(haystack)) return "gemini";
  if (/(gpt|openai)/.test(haystack)) return "openai";
  if (/nous/.test(haystack)) return "nous";
  if (/(moonshot|kimi)/.test(haystack)) return "moonshot";
  if (/(meta|llama)/.test(haystack)) return "meta";
  if (/(nvidia|nemotron)/.test(haystack)) return "nvidia";
  if (/openrouter/.test(haystack)) return "openrouter";
  return "unknown";
}

interface Props {
  provider?: string;
  modelId?: string;
  size?: number;
  matchTheme?: boolean;
  className?: string;
}

function BrandLogo({
  provider,
  modelId,
  size = 20,
  matchTheme = true,
  className = "",
}: Props): React.JSX.Element {
  const brand = detectBrand(provider, modelId);

  if (brand === "unknown") {
    return (
      <Bot
        size={size}
        className={`brand-logo brand-logo--fallback ${className}`.trim()}
      />
    );
  }

  const classes = [
    "brand-logo",
    matchTheme ? "brand-logo--match-theme" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <img
      src={LOGOS[brand]}
      width={size}
      height={size}
      className={classes}
      alt={brand}
    />
  );
}

export default BrandLogo;
