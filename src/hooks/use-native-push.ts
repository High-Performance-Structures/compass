"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useNative, useNativePlatform } from "./use-native"

export function useNativePush() {
  const native = useNative()
  const platform = useNativePlatform()
  const router = useRouter()
  const registered = useRef(false)

  useEffect(() => {
    if (!native || registered.current) return

    let cleanup: (() => void) | undefined

    async function setup() {
      const { PushNotifications } = await import(
        "@capacitor/push-notifications"
      )

      const permResult =
        await PushNotifications.requestPermissions()
      if (permResult.receive !== "granted") return

      await PushNotifications.register()

      const regListener =
        await PushNotifications.addListener(
          "registration",
          async (token) => {
            try {
              await fetch("/api/push/register", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  token: token.value,
                  platform:
                    platform === "web"
                      ? "android"
                      : platform,
                }),
              })
              registered.current = true
            } catch (err) {
              console.error(
                "Push token registration failed:",
                err,
              )
            }
          },
        )

      const errorListener =
        await PushNotifications.addListener(
          "registrationError",
          (err) => {
            console.error("Push registration error:", err)
          },
        )

      // foreground notification
      const receivedListener =
        await PushNotifications.addListener(
          "pushNotificationReceived",
          (notification) => {
            console.log(
              "Push received in foreground:",
              notification,
            )
          },
        )

      // notification tapped
      const actionListener =
        await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            const url = action.notification.data?.url
            if (typeof url === "string" && url.startsWith("/")) {
              router.push(url)
            }
          },
        )

      cleanup = () => {
        regListener.remove()
        errorListener.remove()
        receivedListener.remove()
        actionListener.remove()
      }
    }

    setup()

    return () => cleanup?.()
  }, [native, platform, router])
}

// Thin wrapper component for use in layout
export function PushNotificationRegistrar() {
  useNativePush()
  return null
}
