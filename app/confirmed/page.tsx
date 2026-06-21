"use client"
import Link from "next/link"
import { useEffect, useState } from "react"
export default function ConfirmedPage(){const [email,setEmail]=useState("");useEffect(()=>setEmail(new URLSearchParams(window.location.search).get("email")??""),[]);return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">Email confirmed</h1><p className="mt-3 text-neutral-300">Thank you for confirming {email || "your email"}. You can log in to your account now.</p><Link href="/login" className="mt-6 inline-block text-sm underline">Log in</Link></div></main>}
