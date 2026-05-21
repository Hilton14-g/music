import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Search, Play, Pause, SkipBack, SkipForward, Volume2, Music, Heart, Loader2, WifiOff, Zap, Lock, SkipForward as SkipIcon } from 'lucide-react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:8000' : '/api');

function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [savedSongs, setSavedSongs] = useState([]);
  const [isProcessing, setIsProcessing] = useState(null);
  const [view, setView] = useState('search');
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  const [seenIds, setSeenIds] = useState(new Set());
  const [seenTitles, setSeenTitles] = useState(new Set());
  const [skippedIds, setSkippedIds] = useState(new Set());
  
  const iframeRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  const DB_NAME = 'MusicOfflineDB';
  const STORE_NAME = 'songs';

  const getFilteredResults = () => {
    return (view === 'library' || isOffline) 
      ? savedSongs 
      : results.filter(song => !skippedIds.has(song.id));
  };

  useEffect(() => {
    const handleStatus = () => {
      const offline = !navigator.onLine;
      setIsOffline(offline);
      if (offline) setView('library');
    };
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    loadSavedSongs();

    return () => {
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
      clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      setSeenIds(new Set());
      setSeenTitles(new Set());
      setSkippedIds(new Set());
      return;
    }

    clearTimeout(searchTimeoutRef.current);
    
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, 500);

    return () => clearTimeout(searchTimeoutRef.current);
  }, [query]);

  const loadSavedSongs = () => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const getAll = store.getAll();
      getAll.onsuccess = () => setSavedSongs(getAll.result);
    };
  };

  const toggleFavorite = async (song) => {
    const isSaved = savedSongs.find(s => s.id === song.id);
    const dbRequest = indexedDB.open(DB_NAME, 1);

    if (isSaved) {
      dbRequest.onsuccess = (e) => {
        const db = e.target.result;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).delete(song.id);
        setSavedSongs(prev => prev.filter(s => s.id !== song.id));
      };
      return;
    }

    setIsProcessing(song.id);
    try {
      alert("⚠️ La descarga para offline puede fallar en producción. Usa la reproducción normal.");
    } finally {
      setIsProcessing(null);
    }
  };

  useEffect(() => {
    let interval = null;
    if (isPlaying && currentSong) {
      interval = setInterval(() => {
        setProgress(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSong]);

  useEffect(() => {
    if (duration > 0 && progress >= duration) {
      playNext();
    }
  }, [progress, duration]);

  const normalizeTitle = (title) => {
    return (title || '')
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñ]/g, '')
      .replace(/(official|video|audio|lyric|lyrics|ft|feat|remix|version|edit|extended|original|mix|radio|edit|clean|explicit)/gi, '')
      .trim();
  };

  const performSearch = async (searchQuery) => {
    if (!searchQuery || searchQuery.length < 2) return;
    
    setLoading(true);
    setPage(1);
    setHasMore(true);
    setView('search');
    const newSeenIds = new Set();
    const newSeenTitles = new Set();
    const uniqueResults = [];
    
    try {
      const response = await axios.post(`${API_URL}/search`, { query: searchQuery, limit: 15, page: 1 });
      if (response.data.success) {
        if (response.data.results.length === 0) setHasMore(false);
        for (const song of response.data.results) {
          const normalizedTitle = normalizeTitle(song.title);
          if (!newSeenIds.has(song.id) && !newSeenTitles.has(normalizedTitle)) {
            newSeenIds.add(song.id);
            newSeenTitles.add(normalizedTitle);
            uniqueResults.push(song);
          }
        }
        setResults(uniqueResults);
        setSeenIds(newSeenIds);
        setSeenTitles(newSeenTitles);
      }
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!query) return;
    performSearch(query);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    
    try {
      const response = await axios.post(`${API_URL}/search`, { query, limit: 15, page: nextPage });
      if (response.data.success) {
        const newSongs = response.data.results;
        if (newSongs.length === 0) {
          setHasMore(false);
        } else {
          const newUnique = [];
          const updatedSeenIds = new Set(seenIds);
          const updatedSeenTitles = new Set(seenTitles);
          
          for (const song of newSongs) {
            const normalizedTitle = normalizeTitle(song.title);
            if (!updatedSeenIds.has(song.id) && !updatedSeenTitles.has(normalizedTitle) && !skippedIds.has(song.id)) {
              updatedSeenIds.add(song.id);
              updatedSeenTitles.add(normalizedTitle);
              newUnique.push(song);
            }
          }
          
          setResults(prev => [...prev, ...newUnique]);
          setSeenIds(updatedSeenIds);
          setSeenTitles(updatedSeenTitles);
          setPage(nextPage);
        }
      }
    } catch (error) { console.error(error); }
    finally { setLoadingMore(false); }
  };

  useEffect(() => {
    const handleScroll = () => {
      if (window.innerHeight + document.documentElement.scrollTop + 100 >= document.documentElement.scrollHeight) {
        if (!loading && !loadingMore && view === 'search' && !isOffline && query) {
          loadMore();
        }
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loading, loadingMore, view, isOffline, query, page]);

  const playSong = (song) => {
    setCurrentSong(song);
    setDuration(song.duration || 0);
    setProgress(0);
    setIsPlaying(true);
    setUseProxy(false); // Reset proxy on new song
  };

  const handleAudioError = () => {
    console.log("Error en reproducción normal, activando proxy de bypass...");
    setUseProxy(true);
  };

  const togglePlay = () => {
    setIsPlaying(prev => !prev);
  };

  const playNext = () => {
    const list = getFilteredResults();
    const idx = list.findIndex(s => s.id === currentSong?.id);
    if (idx !== -1 && idx < list.length - 1) {
      playSong(list[idx + 1]);
    }
  };

  const playPrevious = () => {
    const list = getFilteredResults();
    const idx = list.findIndex(s => s.id === currentSong?.id);
    if (idx > 0) {
      playSong(list[idx - 1]);
    }
  };

  const skipAndHideSong = (songId) => {
    setSkippedIds(prev => new Set([...prev, songId]));
    playNext();
  };

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = currentSong ? new MediaMetadata({
        title: currentSong.title,
        artist: currentSong.uploader,
        album: 'TuMusic',
        artwork: [{ src: currentSong.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
      }) : null;

      navigator.mediaSession.setActionHandler('play', () => {
        setIsPlaying(true);
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        setIsPlaying(false);
      });

      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
    }
  }, [currentSong, isPlaying]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (currentSong && progress === 0 && isPlaying && !useProxy) {
        console.log("Canción bloqueada o no carga, activando bypass...");
        handleAudioError();
      }
    }, 8000);
    
    return () => clearTimeout(timeout);
  }, [currentSong, progress, isPlaying, useProxy]);

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    setProgress(time);
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`app-container ${isOffline ? 'offline' : ''}`}>
      
      {showIntro && (
        <div className="intro-screen">
          <div className="intro-logo">
            <Music color="#ff0050" size={80} />
            <h1>TuMusic</h1>
          </div>
          
          <div className="intro-features">
            <div className="intro-feature">
              <Zap size={48} />
              <span>Búsqueda Instantánea</span>
            </div>
            <div className="intro-feature">
              <Music size={48} />
              <span>Música Sin Límites</span>
            </div>
            <div className="intro-feature">
              <SkipIcon size={48} />
              <span>Auto-Skip Inteligente</span>
            </div>
          </div>
          
          <div className="intro-note">
            <p><span className="highlight">App en desarrollo</span> — Algunas canciones con derechos de autor se saltan automáticamente.</p>
            <p>Disfruta de la música!</p>
          </div>
          
          <button className="intro-continue-btn" onClick={() => setShowIntro(false)}>
            Continuar a la App
          </button>
        </div>
      )}

      {currentSong && !useProxy && (
        <iframe
          key={currentSong.id}
          ref={iframeRef}
          style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: '1px', height: '1px', visibility: 'hidden' }}
          src={`https://www.youtube.com/embed/${currentSong.id}?autoplay=${isPlaying ? 1 : 0}&controls=0&showinfo=0&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${window.location.origin}&widgetid=1`}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          title={currentSong.title}
          onError={handleAudioError}
        />
      )}

      {currentSong && useProxy && (
        <audio
          key={`proxy-${currentSong.id}`}
          autoPlay={isPlaying}
          src={`${API_URL}/stream?video_id=${currentSong.id}`}
          onEnded={playNext}
          onError={() => {
            console.log("Bypass fallido, saltando canción...");
            playNext();
          }}
          style={{ display: 'none' }}
        />
      )}
      
      <div className={`youtube-player-container ${isPlayerExpanded ? 'expanded' : ''} ${!showVideo ? 'hidden' : ''}`}>
        <div className="player-header">
          <button className="player-header-btn" onClick={() => setIsPlayerExpanded(!isPlayerExpanded)} title={isPlayerExpanded ? "Minimizar" : "Pantalla Completa"}>
            {isPlayerExpanded ? <div style={{width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>⊟</div> : <div style={{width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>⛶</div>}
          </button>
        </div>
        <div className="youtube-player-body">
          <div className="youtube-video-wrapper">
            {currentSong ? (
               <div className="audio-image-container">
                 <img src={currentSong.thumbnail.replace('hqdefault.jpg', 'maxresdefault.jpg')} alt={currentSong.title} className="audio-bg-image" />
                 <div className="audio-image-overlay">
                   <img src={currentSong.thumbnail} alt={currentSong.title} className={`audio-center-image ${isPlaying ? 'playing-animation' : ''}`} />
                 </div>
               </div>
            ) : null}
          </div>
          {isPlayerExpanded && (
            <div className="youtube-player-queue">
              <h3>Siguientes en la lista</h3>
              <div className="queue-list">
                {getFilteredResults().map((song) => (
                  <div key={song.id} className={`queue-item ${song.id === currentSong?.id ? 'active' : ''}`} onClick={() => playSong(song)}>
                    <img src={song.thumbnail} alt={song.title} className="queue-thumb" />
                    <div className="queue-info">
                      <p className="queue-title">{song.title}</p>
                      <p className="queue-artist">{song.uploader}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <header className="header">
        <div className="logo" onClick={() => setView('search')}>
          <Music color="#ff0050" size={32} />
          <span>TuMusic {isOffline && <WifiOff size={16} color="#ffaa00" />}</span>
        </div>
        
        <nav className="header-nav">
          {!isOffline && <button className={`nav-item ${view === 'search' ? 'active' : ''}`} onClick={() => setView('search')}>Explorar</button>}
          <button className={`nav-item ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')}>Me Gusta <span className="count">{savedSongs.length}</span></button>
        </nav>

        {!isOffline && (
          <div className="search-bar">
            <Search className="search-icon" size={20} />
            <input type="text" placeholder="Busca música, artistas, álbumes..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
      </header>

      <main className="main-content">
        <div className="content-inner">
          <h2 className="section-title">
            {isOffline ? '📍 Modo Offline Activo' : view === 'library' ? '💖 Tus Me Gusta' : '🔎 Resultados'}
          </h2>
          
          <div className="results-grid">
            {getFilteredResults().map((song) => (
              <div key={song.id} className={`song-card ${currentSong?.id === song.id ? 'active' : ''}`} onClick={() => playSong(song)}>
                <div className="thumbnail-container">
                  <img src={song.thumbnail} alt={song.title} />
                  <div className="play-overlay"><Play fill="white" size={40} /></div>
                </div>
                <div className="song-info">
                  <h3 className="song-title">{song.title}</h3>
                  <p className="song-artist">{song.uploader}</p>
                  <div className="song-footer">
                    <span className="duration-tag">{formatDuration(song.duration)}</span>
                    {!isOffline && (
                      <button className={`heart-btn ${savedSongs.find(s => s.id === song.id) ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(song); }} disabled={isProcessing === song.id}>
                        {isProcessing === song.id ? <Loader2 className="animate-spin" size={20} /> : <Heart fill={savedSongs.find(s => s.id === song.id) ? "#ff0050" : "none"} color={savedSongs.find(s => s.id === song.id) ? "#ff0050" : "white"} size={20} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {loading && (
            <div className="loading-spinner">
              <Loader2 className="animate-spin" size={48} color="#ff0050" />
              <p>Buscando la mejor música...</p>
            </div>
          )}

          {!loading && view === 'search' && !isOffline && getFilteredResults().length === 0 && query && (
            <div className="empty-state">
              <Music size={64} />
              <p>No encontramos resultados para "{query}"</p>
            </div>
          )}

          {view === 'search' && !isOffline && getFilteredResults().length > 0 && hasMore && (
            <div className="load-more-container">
              <button className="load-more-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    <span>Cargando más música...</span>
                  </>
                ) : (
                  <span>Desliza para ver más</span>
                )}
              </button>
            </div>
          )}
        </div>
      </main>

      {currentSong && (
        <footer className="player-bar">
          <div className="player-info">
            <img src={currentSong.thumbnail} alt={currentSong.title} />
            <div>
              <h4>{currentSong.title}</h4>
              <p>{currentSong.uploader} {currentSong.isLocal && "• Offline"}</p>
            </div>
          </div>

          <div className="player-controls">
            <div className="buttons">
              <button onClick={playPrevious}><SkipBack size={24} /></button>
              <button className="play-pause" onClick={togglePlay}>{isPlaying ? <Pause size={32} fill="white" /> : <Play size={32} fill="white" />}</button>
              <button onClick={playNext}><SkipForward size={24} /></button>
            </div>
            <div className="progress-container">
              <span className="time-text">{formatDuration(progress)}</span>
              <input type="range" className="progress-slider" min="0" max={duration || 0} value={progress} onChange={handleSeek} />
              <span className="time-text">{formatDuration(duration)}</span>
            </div>
          </div>

          <div className="player-volume">
            <Volume2 size={20} />
            <input type="range" min="0" max="100" defaultValue="80" onChange={(e) => {
              const v = e.target.value / 100;
            }} />
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;
