import yt_dlp

def test_search(query, start, end):
    ydl_opts = {
        'extract_flat': True,
        'playlist_items': f"{start}-{end}",
        'quiet': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        # Note: when using playlist_items, the number in ytsearch:N is usually the limit
        # but playlist_items should override or filter it.
        results = ydl.extract_info(f"ytsearch{end}:{query}", download=False)
        entries = results.get('entries', [])
        print(f"Results {start}-{end} for '{query}': {len(entries)} items")
        for i, entry in enumerate(entries):
            print(f"{i+start}. {entry.get('title')}")

print("--- Batch 1 (1-5) ---")
test_search("boleros", 1, 5)
print("\n--- Batch 2 (6-10) ---")
test_search("boleros", 6, 10)
