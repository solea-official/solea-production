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
        href="https://www.facebook.com/share/1Eqf2ofj4V/?mibextid=wwXIfr"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("SOLÉA on Facebook", "SOLÉA على فيسبوك")}
        title={t("Visit SOLÉA on Facebook", "زيارة SOLÉA على فيسبوك")}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M24 12a12 12 0 1 0-13.875 11.855v-8.386H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.234 2.686.234v2.953h-1.513c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.469h-2.796v8.386A12.003 12.003 0 0 0 24 12Z" />
        </svg>
        <span>Facebook</span>
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
      <a
        href="https://wa.me/201039010190"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("Contact SOLÉA on WhatsApp", "تواصل مع SOLÉA عبر واتساب")}
        title={t("SOLÉA WhatsApp support", "دعم SOLÉA عبر واتساب")}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M20.52 3.48A11.91 11.91 0 0 0 12.04 0C5.47 0 .12 5.35.12 11.92c0 2.1.55 4.15 1.59 5.95L0 24l6.28-1.65a11.9 11.9 0 0 0 5.75 1.46h.01c6.57 0 11.92-5.35 11.92-11.92a11.85 11.85 0 0 0-3.44-8.41ZM12.04 21.8a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.73.98 1-3.64-.24-.37a9.9 9.9 0 1 1 8.37 4.62Zm5.43-7.42c-.3-.15-1.76-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.88-.79-1.48-1.76-1.65-2.06-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.21 5.08 4.5.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35Z" />
        </svg>
        <span>WhatsApp</span>
      </a>
    </div>
  );
}
