from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
import os
import requests
import urllib.request

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")

@app.get("/")
def home():
    return {"status": "online", "using_youtube_api": bool(YOUTUBE_API_KEY)}

def parse_duration(duration_str):
    import re
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds

@app.post("/api/search")
def search_music(data: dict):
    query = data.get("query")
    limit = data.get("limit", 15)
    page = data.get("page", 1)
    
    try:
        if YOUTUBE_API_KEY:
            try:
                url = "https://www.googleapis.com/youtube/v3/search"
                params = {
                    "part": "snippet", "q": query, "type": "video",
                    "maxResults": limit, "key": YOUTUBE_API_KEY
                }
                response = requests.get(url, params=params, timeout=20)
                response.raise_for_status()
                data = response.json()
                video_ids = [item["id"]["videoId"] for item in data.get("items", []) if item.get("id", {}).get("videoId")]
                
                if video_ids:
                    videos_url = "https://www.googleapis.com/youtube/v3/videos"
                    videos_params = {"part": "snippet,contentDetails", "id": ",".join(video_ids), "key": YOUTUBE_API_KEY}
                    videos_response = requests.get(videos_url, params=videos_params, timeout=20)
                    videos_response.raise_for_status()
                    videos_data = videos_response.json()
                    results = []
                    for item in videos_data.get("items", []):
                        duration = parse_duration(item["contentDetails"]["duration"])
                        results.append({
                            "id": item["id"], "title": item["snippet"]["title"], "duration": duration,
                            "thumbnail": f"https://i.ytimg.com/vi/{item['id']}/hqdefault.jpg",
                            "uploader": item["snippet"]["channelTitle"]
                        })
                    if results:
                        return {"success": True, "results": results, "source": "youtube_api"}
            except Exception as e:
                print(f"API error: {e}")
        
        ydl_opts = {
            'extract_flat': 'in_playlist',
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'lazy_playlist': True,
            'format': 'bestaudio/best',
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            res = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
            results = []
            for e in res.get('entries', []):
                if e:
                    results.append({
                        "id": e["id"], "title": e["title"], "duration": e.get("duration"),
                        "thumbnail": f"https://i.ytimg.com/vi/{e['id']}/hqdefault.jpg",
                        "uploader": e.get("uploader")
                    })
            return {"success": True, "results": results, "source": "yt_dlp"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stream")
def stream_audio(video_id: str, request: Request):
    try:
        # Intentar múltiples formatos para saltar bloqueos
        ydl_opts = {
            'format': 'bestaudio/best',
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'socket_timeout': 30,
            'nocheckcertificate': True,
            'extractor_args': {'youtube': {'player_client': ['android', 'web', 'mweb']}},
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            audio_url = info.get("url")
            
            if not audio_url:
                raise HTTPException(status_code=500, detail="No audio URL found")
            
            # Forzar headers de navegador para evitar 403
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.youtube.com/',
                'Origin': 'https://www.youtube.com'
            }
            
            range_header = request.headers.get('Range')
            if range_header:
                headers['Range'] = range_header
            
            # Usar requests para un streaming más estable que urllib
            session = requests.Session()
            resp = session.get(audio_url, headers=headers, stream=True, timeout=30)
            
            def iterfile():
                for chunk in resp.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        yield chunk
            
            resp_headers = {
                "Content-Type": resp.headers.get("Content-Type", "audio/mpeg"),
                "Accept-Ranges": "bytes",
            }
            if "Content-Range" in resp.headers:
                resp_headers["Content-Range"] = resp.headers["Content-Range"]
            if "Content-Length" in resp.headers:
                resp_headers["Content-Length"] = resp.headers["Content-Length"]
            
            return StreamingResponse(iterfile(), status_code=resp.status_code, headers=resp_headers)
            
    except Exception as e:
        print(f"Streaming error: {e}")
        # Si falla el proxy, intentamos redirigir como última opción
        return {"error": str(e)}
