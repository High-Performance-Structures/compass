"use client"

import { createContext, useContext } from "react"

const FormIdContext = createContext<string>("default")

export const FormIdProvider = FormIdContext.Provider

export function useFormId(): string {
  return useContext(FormIdContext)
}
