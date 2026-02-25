export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header skeleton */}
        <div className="mb-8">
          <div className="h-7 w-32 bg-gray-800 animate-pulse rounded-lg" />
          <div className="h-4 w-48 bg-gray-800 animate-pulse rounded mt-1" />
        </div>

        {/* Stats bar skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4">
              <div className="h-3 w-24 bg-gray-800 animate-pulse rounded mb-2" />
              <div className="h-8 w-16 bg-gray-800 animate-pulse rounded-lg" />
            </div>
          ))}
        </div>

        {/* Main + Sidebar skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          <div className="h-96 bg-gray-800 animate-pulse rounded-xl" />
          <div className="flex flex-col gap-4">
            <div className="h-48 bg-gray-800 animate-pulse rounded-xl" />
            <div className="h-48 bg-gray-800 animate-pulse rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
