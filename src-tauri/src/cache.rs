use std::sync::Mutex;
use std::time::Instant;

use crate::commands::data::{FullDayStats, GlobalToolStat, ToolSequence};

pub struct StatsCache {
    pub full_stats: Mutex<Option<CachedData<Vec<FullDayStats>>>>,
    pub tool_stats: Mutex<Option<CachedData<(Vec<GlobalToolStat>, Vec<ToolSequence>)>>>,
}

pub struct CachedData<T> {
    pub data: T,
    pub computed_at: Instant,
}

impl StatsCache {
    pub fn new() -> Self {
        Self {
            full_stats: Mutex::new(None),
            tool_stats: Mutex::new(None),
        }
    }
}

const CACHE_TTL_SECS: u64 = 300; // 5 minutes

impl StatsCache {
    pub fn get_full_stats(&self) -> Option<Vec<FullDayStats>> {
        let guard = self.full_stats.lock().ok()?;
        let cached = guard.as_ref()?;
        if cached.computed_at.elapsed().as_secs() < CACHE_TTL_SECS {
            Some(cached.data.clone())
        } else {
            None
        }
    }

    pub fn set_full_stats(&self, data: Vec<FullDayStats>) {
        if let Ok(mut guard) = self.full_stats.lock() {
            *guard = Some(CachedData {
                data,
                computed_at: Instant::now(),
            });
        }
    }

    pub fn get_tool_stats(&self) -> Option<(Vec<GlobalToolStat>, Vec<ToolSequence>)> {
        let guard = self.tool_stats.lock().ok()?;
        let cached = guard.as_ref()?;
        if cached.computed_at.elapsed().as_secs() < CACHE_TTL_SECS {
            Some(cached.data.clone())
        } else {
            None
        }
    }

    pub fn set_tool_stats(&self, data: (Vec<GlobalToolStat>, Vec<ToolSequence>)) {
        if let Ok(mut guard) = self.tool_stats.lock() {
            *guard = Some(CachedData {
                data,
                computed_at: Instant::now(),
            });
        }
    }
}
