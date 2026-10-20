export default function LoadingScreen({ title }: { title?: string }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-7 bg-ink">
      <img src="logo.png" alt="" className="h-20 w-20 object-contain" />
      <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/15 border-t-cta" />
      <p className="text-sm tracking-wide text-white/60">{title ?? 'Please wait...'}</p>
    </div>
  )
}
