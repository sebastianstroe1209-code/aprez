'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function Page() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('restaurantToken')
    if (token) {
      router.push('/dashboard')
    } else {
      router.push('/login')
    }
  }, [router])

  return <div className="flex items-center justify-center min-h-screen">Redirecting...</div>
}
