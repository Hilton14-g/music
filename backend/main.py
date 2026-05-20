# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
import yt_dlp
import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi.responses import StreamingResponse
import requests
import random
import time

app = FastAPI(title="Mi YouTube Music API")
executor = ThreadPoolExecutor(max_workers=10)
search_cache = {}
url_cache = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36"
]

class SearchQuery(BaseModel):
    query: str
    limit: int = 15
    page: int = 1

class SongRequest(BaseModel):
    video_id: str

@app.get("/")
def inicio():
    return {"mensaje": "¡El servidor de música está vivo y corriendo!"}

@app.post("/search")
def search_music(data: SearchQuery):
    start_index = (data.page - 1) * data.limit + 1
    end_index = data.page * data.limit
    
    cache_key = f"{data.query}_{data.limit}_{data.page}"
    if cache_key in search_cache:
        print(f"Sirviendo desde el cache: {cache_key}")
        return {"success": True, "results": search_cache[cache_key]}

    # Usamos extract_flat para que sea ULTRA RÁPIDO
    # OPTIMIZACIÓN: Solo buscamos data.limit resultados, no end_index
    # Usamos playliststart para manejar la paginación
    ydl_opts = {
        'extract_flat': 'in_playlist',  # Más rápido para búsquedas
        'force_generic_extractor': False,
        'quiet': True,
        'no_warnings': True,
        'playliststart': start_index,
        'playlistend': end_index,
        'skip_download': True,
        'lazy_playlist': True,
        'format': 'bestaudio/best',
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # OPTIMIZACIÓN: Solo buscamos data.limit resultados por página
            search_results = ydl.extract_info(f"ytsearch{data.limit}:{data.query}", download=False)
            
            # DEDUPLICACIÓN: Usamos un set para evitar canciones repetidas
            seen_ids = set()
            seen_titles = set()
            songs = []
            
            for entry in search_results.get('entries', []):
                if entry:
                    song_id = entry.get("id") or entry.get("url")
                    title = entry.get("title", "").lower().strip()
                    
                    # Limpiar título para mejor comparación (remover caracteres especiales)
                    clean_title = ''.join(c for c in title if c.isalnum() or c.isspace())
                    
                    # Verificar si ya existe por ID o por título limpio
                    if song_id not in seen_ids and clean_title not in seen_titles:
                        seen_ids.add(song_id)
                        seen_titles.add(clean_title)
                        songs.append({
                            "id": song_id,
                            "title": entry.get("title"),
                            "duration": entry.get("duration"),
                            "thumbnail": f"https://i.ytimg.com/vi/{song_id}/hqdefault.jpg",
                            "uploader": entry.get("uploader") or entry.get("channel"),
                        })
            
            # Guardamos en cache
            search_cache[cache_key] = songs
            print(f"Encontrados {len(songs)} canciones únicas para '{data.query}'")
            return {"success": True, "results": songs}
            
    except Exception as e:
        print(f"Error en search: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get_url")
def get_song_url(data: SongRequest):
    if data.video_id in url_cache:
        print(f"URL de audio desde cache: {data.video_id}")
        return url_cache[data.video_id]

    # Lista de formatos a intentar en orden de preferencia
    formats_to_try = [
        'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best',
        'bestaudio[ext=webm]/bestaudio/best',
        'bestaudio/best',
    ]
    
    # User-Agent aleatorio para evitar bloqueos
    user_agent = random.choice(USER_AGENTS)
    
    for format_str in formats_to_try:
        ydl_opts = {
            'format': format_str,
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'user_agent': user_agent,
            'socket_timeout': 30,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={data.video_id}", download=False)
                audio_url = info.get("url")
                
                if not audio_url:
                    print(f"No se obtuvo URL de audio con formato: {format_str}")
                    continue
                
                result = {
                    "success": True, 
                    "audio_url": audio_url,
                    "duration": info.get("duration"),
                    "title": info.get("title")
                }
                url_cache[data.video_id] = result
                print(f"URL obtenida exitosamente con formato: {format_str}")
                return result
        except Exception as e:
            print(f"Error en get_url con formato {format_str}: {e}")
            time.sleep(0.5)  # Pequeña pausa antes de reintentar
            continue
    
    print(f"Error: No se pudo obtener URL para video_id={data.video_id} después de intentar todos los formatos")
    raise HTTPException(status_code=500, detail="No se pudo obtener el audio de esta canción. Intenta con otra.")

from fastapi import Request
import urllib.request

@app.get("/download")
def download(video_id: str, request: Request, title: str = ""):
    # Forzar formato MP3 para máxima compatibilidad en Vercel
    formats_to_try = [
        'bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio',
        'bestaudio[ext=m4a]/bestaudio',
        'bestaudio',
    ]
    
    # User-Agent aleatorio para evitar bloqueos
    user_agent = random.choice(USER_AGENTS)
    
    for format_str in formats_to_try:
        ydl_opts = {
            'format': format_str,
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'user_agent': user_agent,
            'socket_timeout': 60,  # Timeout más largo para Vercel
            'nocheckcertificate': True,
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                audio_url = info.get("url")
                
                if not audio_url:
                    print(f"No se obtuvo URL de audio con formato: {format_str}")
                    continue
                
                # Para Vercel, mejor redirigir a la URL directa de YouTube
                # en lugar de hacer streaming proxy
                from fastapi.responses import RedirectResponse
                
                print(f"Redirigiendo a audio URL: {format_str}")
                return RedirectResponse(
                    url=audio_url,
                    status_code=302,
                    headers={
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    }
                )
                
        except Exception as e:
            print(f"Error con formato {format_str}: {e}")
            time.sleep(0.5)
            continue
    
    print(f"Error: No se pudo cargar el audio para video_id={video_id}")
    raise HTTPException(status_code=500, detail="No se pudo cargar el audio de esta canción. Intenta con otra.")