export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Breadcrumb skeleton */}
        <div className="h-4 w-32 bg-gray-800 animate-pulse rounded mb-8" />

        {/* Header skeleton */}
        <div className="mb-8 space-y-3">
          <div className="h-12 w-40 bg-gray-800 animate-pulse rounded-lg" />
          <div className="h-6 w-64 bg-gray-800 animate-pulse rounded-lg" />
          <div className="h-4 w-24 bg-gray-800 animate-pulse rounded" />
        </div>

        {/* Price bar skeleton */}
        <div className="h-16 bg-gray-800 animate-pulse rounded-xl mb-6" />

        {/* Tab nav skeleton */}
        <div className="flex gap-1 mb-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-9 w-24 bg-gray-800 animate-pulse rounded-t-md" />
          ))}
        </div>

        {/* Content skeleton */}
        <div className="space-y-4">
          <div className="h-[180px] bg-gray-800 animate-pulse rounded-xl" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-20 bg-gray-800 animate-pulse rounded-lg" />
            <div className="h-20 bg-gray-800 animate-pulse rounded-lg" />
            <div className="h-20 bg-gray-800 animate-pulse rounded-lg" />
          </div>
          <div className="h-24 bg-gray-800 animate-pulse rounded-xl" />
        </div>
      </div>
    </div>
  );
}
