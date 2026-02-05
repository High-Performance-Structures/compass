"use client";

import * as React from "react";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type PasswordInputProps = React.ComponentProps<typeof Input>;

export function PasswordInput({ className, ...props }: PasswordInputProps) {
    const [showPassword, setShowPassword] = React.useState(false);

    // Use props directly - the type system already constrains what can be passed
    const safeProps = props;

    return (
        <div className="relative">
            <Input
                type={showPassword ? "text" : "password"}
                className={className}
                autoComplete="current-password"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                {...safeProps}
            />
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 size-7"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
            >
                {showPassword ? (
                    <IconEyeOff className="size-4" />
                ) : (
                    <IconEye className="size-4" />
                )}
                <span className="sr-only">
                    {showPassword ? "Hide password" : "Show password"}
                </span>
            </Button>
        </div>
    );
}
