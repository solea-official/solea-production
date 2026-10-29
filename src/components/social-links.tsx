"use client";
import { useStore } from "./provider";
export function SocialLinks() {
  const { data, t } = useStore();
  return (
    <div className="footer-social-links">
      <a
        href={"https://www.instagram.com/" + data.settings.instagram + "/"}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("SOLÉA on Instagram", "SOLÉA على إنستجرام")}
        title={t("Visit SOLÉA on Instagram", "زيارة SOLÉA على إنستجرام")}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
        <span>
          Instagram <bdi>@{data.settings.instagram}</bdi>
        </span>
      </a>
      <a
        href="https://www.tiktok.com/@soleababy.egypt"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("SOLÉA on TikTok", "SOLÉA على تيك توك")}
        title={t("Visit SOLÉA on TikTok", "زيارة SOLÉA على تيك توك")}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M16.7 1h-3.8v14.8a3.3 3.3 0 1 1-2.8-3.2V8.8a7 7 0 1 0 6.6 7V8.2a9.3 9.3 0 0 0 5.3 1.7V6.1A5.4 5.4 0 0 1 16.7 1Z" />
        </svg>
        <span>
          TikTok <bdi>@soleababy.egypt</bdi>
        </span>
      </a>
    </div>
  );
}
