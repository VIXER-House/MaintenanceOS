-- CreateTable
CREATE TABLE "whatsapp_auth" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_auth_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "whatsapp_bridge_session" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL DEFAULT 'offline',
    "qr" TEXT,
    "phone" TEXT,
    "error" TEXT,
    "logoutRequested" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_bridge_session_pkey" PRIMARY KEY ("id")
);
