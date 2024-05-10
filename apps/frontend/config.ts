import { env } from "./env";

const config = {
  sanity: {
    projectId: env.NEXT_PUBLIC_SANITY_PROJECT_ID || "",
    dataset: env.NEXT_PUBLIC_SANITY_DATASET || "",
    // Not exposed to the front-end, used solely by the server
    token: env.SANITY_API_TOKEN || "",
    apiVersion: env.NEXT_PUBLIC_SANITY_API_VERSION || "2023-06-21",
    revalidateSecret: env.SANITY_REVALIDATE_SECRET || "",
    studioUrl: "/manage",
  },
  siteName: "Codemod",
  siteDomain: env.NEXT_PUBLIC_SITE_DOMAIN || "",
  baseUrl: env.NEXT_PUBLIC_BASE_URL || "",
};

export default config;
