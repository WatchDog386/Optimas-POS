export default function LoadingScreen({ title }: { title?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-white">
      <img src="logo.png" alt="Optimas POS" className="h-24 w-auto object-contain" />
      <p className="mt-5 font-display text-lg font-semibold text-slate-900">
        {title ?? 'Loading…'}
      </p>
      <p className="mt-1 text-sm text-slate-400">Preparing your workspace</p>
      <div className="mt-7 h-1.5 w-52 overflow-hidden rounded-full bg-slate-100 shadow-[inset_1px_1px_3px_rgba(15,39,44,0.12)]">
        <div className="h-full w-1/3 animate-loading rounded-full bg-brand-500" />
      </div>
    </div>
  )
}
