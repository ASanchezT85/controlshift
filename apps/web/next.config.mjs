/** @type {import('next').NextConfig} */
export default {
  env: { NEXT_PUBLIC_API: process.env.NEXT_PUBLIC_API ?? 'http://127.0.0.1:3000/api' },
};
