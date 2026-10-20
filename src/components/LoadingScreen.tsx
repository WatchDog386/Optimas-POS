export default function LoadingScreen({ title }: { title?: string }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-white">
      <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-slate-200 border-t-cta" />
      <p className="text-sm tracking-wide text-slate-500">{title ?? 'Please wait...'}</p>
    </div>
  )
}
