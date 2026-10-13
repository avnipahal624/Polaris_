import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, Mail, Navigation2, RefreshCw, ShieldCheck, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(searchParams.get("returnTo"), redirectAfterAuth);
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);
      setError("The verification code you entered is incorrect.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Failed to sign in as guest: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="polar-bg relative flex min-h-screen flex-col overflow-hidden">
      <div className="polar-aurora pointer-events-none absolute inset-0" />

      <div className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Identity panel */}
          <div className="hidden text-slate-800 lg:block">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-blue-800 text-white shadow-md">
                <Navigation2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-2xl leading-none font-extrabold tracking-tight text-slate-900">POLARIS</p>
                <p className="mt-1 text-[10px] font-bold tracking-[0.18em] text-sky-700 uppercase">
                  Integrated Polar Expedition Operations System
                </p>
              </div>
            </div>

            <h1 className="mt-8 text-3xl leading-tight font-extrabold tracking-tight text-slate-900">
              One operational picture for the entire expedition.
            </h1>
            <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-slate-600">
              Sign in to the command console used by NCPOR / MoES control-room teams — live Antarctic operations map, cargo and
              inventory tracking, transport and personnel monitoring, weather and hazard overlays, offline field sync, and the
              POLAR INTELLIGENCE ENGINE with explainable, human-approved recommendations.
            </p>

            <div className="mt-8 space-y-2.5">
              {[
                { icon: ShieldCheck, text: "Explainable AI — every recommendation carries its evidence and awaits human approval" },
                { icon: Navigation2, text: "Map-first operations across stations, camps, vessels and field teams" },
                { icon: RefreshCw, text: "Offline-first: field work continues without coverage and reconciles on reconnect" },
              ].map((f) => (
                <div key={f.text} className="flex items-start gap-2.5">
                  <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <p className="text-[12px] leading-snug font-semibold text-slate-600">{f.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Sign-in card */}
          <div className="flex justify-center">
            <Card className="glass-strong min-w-[340px] rounded-3xl border-white/70 pb-0 shadow-xl">
              {step === "signIn" ? (
                <>
                  <CardHeader className="text-center">
                    <div className="flex justify-center lg:hidden">
                      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-blue-800 text-white shadow-md">
                        <Navigation2 className="h-5 w-5" />
                      </span>
                    </div>
                    <CardTitle className="text-xl">Command Center sign-in</CardTitle>
                    <CardDescription>
                      Enter your operational email to receive a one-time access code.
                    </CardDescription>
                  </CardHeader>
                  <form onSubmit={handleEmailSubmit}>
                    <CardContent>
                      <div className="relative flex items-center gap-2">
                        <div className="relative flex-1">
                          <Mail className="absolute top-3 left-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            name="email"
                            placeholder="name@ncpor.res.in"
                            type="email"
                            className="pl-9"
                            disabled={isLoading}
                            required
                          />
                        </div>
                        <Button type="submit" variant="outline" size="icon" disabled={isLoading}>
                          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                        </Button>
                      </div>
                      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

                      <div className="mt-4">
                        <div className="relative">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                          </div>
                          <div className="relative flex justify-center text-xs uppercase">
                            <span className="glass px-2 text-muted-foreground">Or</span>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          className="mt-4 w-full"
                          onClick={handleGuestLogin}
                          disabled={isLoading}
                        >
                          <UserX className="mr-2 h-4 w-4" />
                          Continue as guest operator
                        </Button>
                      </div>
                    </CardContent>
                  </form>
                </>
              ) : (
                <>
                  <CardHeader className="mt-4 text-center">
                    <CardTitle>Check your email</CardTitle>
                    <CardDescription>We sent a one-time access code to {step.email}</CardDescription>
                  </CardHeader>
                  <form onSubmit={handleOtpSubmit}>
                    <CardContent className="pb-4">
                      <input type="hidden" name="email" value={step.email} />
                      <input type="hidden" name="code" value={otp} />

                      <div className="flex justify-center">
                        <InputOTP
                          value={otp}
                          onChange={setOtp}
                          maxLength={6}
                          disabled={isLoading}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                              const form = (e.target as HTMLElement).closest("form");
                              if (form) {
                                form.requestSubmit();
                              }
                            }
                          }}
                        >
                          <InputOTPGroup>
                            {Array.from({ length: 6 }).map((_, index) => (
                              <InputOTPSlot key={index} index={index} />
                            ))}
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      {error && <p className="mt-2 text-center text-sm text-red-500">{error}</p>}
                      <p className="mt-4 text-center text-sm text-muted-foreground">
                        Didn't receive a code?{" "}
                        <Button variant="link" className="h-auto p-0" onClick={() => setStep("signIn")}>
                          Try again
                        </Button>
                      </p>
                    </CardContent>
                    <CardFooter className="flex-col gap-2">
                      <Button type="submit" className="w-full" disabled={isLoading || otp.length !== 6}>
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Verifying...
                          </>
                        ) : (
                          <>
                            Verify code
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStep("signIn")}
                        disabled={isLoading}
                        className="w-full"
                      >
                        Use a different email
                      </Button>
                    </CardFooter>
                  </form>
                </>
              )}

              <div className="rounded-b-lg border-t bg-white/60 px-6 py-3.5 text-center text-xs text-muted-foreground backdrop-blur">
                Protected console · National Centre for Polar and Ocean Research
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
