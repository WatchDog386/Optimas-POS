export default function LoadingScreen({ title }: { title?: string }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white">
      <p className="pb-[15px] text-center text-base font-light text-black">{title ?? 'Please wait...'}</p>
      <div className="h-[131px] w-[131px] animate-[moon-spin_1.45s_ease_infinite] rounded-full border-b-[26px] border-b-[#EF4036] bg-white shadow-[0_0_21px_3px_rgba(130,130,130,0.26)]" />
    </div>
  )
}
