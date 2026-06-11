use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

// ── RNG (xorshift32, same constants as TS version) ──────────────────────────

struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Self {
        Self((seed ^ 0xDEAD_BEEF).max(1))
    }
    fn next(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x as f64 / 0x1_0000_0000u64 as f64
    }
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + self.next() * (b - a)
    }
    fn pick(&mut self, len: usize) -> usize {
        (self.next() * len as f64) as usize
    }
}

// ── Data types ───────────────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: u32,
    pub layer: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    #[serde(rename = "isServer")]
    pub is_server: bool,
    pub parent: Option<u32>,
    pub children: Vec<u32>,
    #[serde(skip)]
    pub _a: f64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Edge {
    pub a: u32,
    pub b: u32,
}

#[derive(Serialize, Deserialize)]
pub struct TopologyResult {
    pub nodes: Vec<Node>,
    #[serde(rename = "treeEdges")]
    pub tree_edges: Vec<Edge>,
    #[serde(rename = "shortcutEdges")]
    pub shortcut_edges: Vec<Edge>,
    pub server: u32,
}

// ── Layer helpers ─────────────────────────────────────────────────────────────

fn layer_counts(n: u32) -> (u32, u32, u32, u32) {
    let core: u32 = 1;
    let dist = 2u32.max(4u32.min((n as f64 * 0.10) as u32));
    let acc = 3u32.max(10u32.min((n as f64 * 0.25) as u32));
    let term = 1u32.max(n.saturating_sub(core + dist + acc));
    (core, dist, acc, term)
}

fn y_for_layer(layer: &str) -> f64 {
    match layer {
        "core" => 36.0,
        "dist" => 20.0,
        "acc" => 4.0,
        _ => -16.0,
    }
}

fn edge_key(a: u32, b: u32) -> u64 {
    let lo = a.min(b) as u64;
    let hi = a.max(b) as u64;
    (lo << 32) | hi
}

// ── Radial positions (mirrors assignRadialPositions) ─────────────────────────

fn leaf_count(id: u32, nodes: &[Node], cache: &mut HashMap<u32, u32>) -> u32 {
    if let Some(&v) = cache.get(&id) {
        return v;
    }
    let node = &nodes[id as usize];
    let v = if node.children.is_empty() {
        1
    } else {
        node.children.iter().map(|&c| leaf_count(c, nodes, cache)).sum()
    };
    cache.insert(id, v);
    v
}

fn assign_arc(id: u32, lo: f64, hi: f64, nodes: &mut Vec<Node>, cache: &mut HashMap<u32, u32>) {
    nodes[id as usize]._a = (lo + hi) / 2.0;
    let children: Vec<u32> = nodes[id as usize].children.clone();
    if children.is_empty() {
        return;
    }
    let total: u32 = children.iter().map(|&c| leaf_count(c, nodes, cache)).sum();
    let mut angle = lo;
    for child_id in children {
        let lc = leaf_count(child_id, nodes, cache);
        let arc = (lc as f64 / total as f64) * (hi - lo);
        assign_arc(child_id, angle, angle + arc, nodes, cache);
        angle += arc;
    }
}

fn assign_radial_positions(
    layer_map: &HashMap<&str, Vec<u32>>,
    nodes: &mut Vec<Node>,
    rng: &mut Rng,
) {
    let radius: HashMap<&str, f64> = [("dist", 27.0), ("acc", 56.0), ("term", 86.0)].into();
    let jitter: HashMap<&str, f64> = [("dist", 2.0), ("acc", 3.0), ("term", 4.0)].into();

    let mut cache: HashMap<u32, u32> = HashMap::new();
    for &id in layer_map["core"].iter() {
        nodes[id as usize].x = rng.range(-2.0, 2.0);
        nodes[id as usize].z = rng.range(-2.0, 2.0);
        nodes[id as usize]._a = 0.0;
        assign_arc(id, 0.0, std::f64::consts::TAU, nodes, &mut cache);
    }
    for layer in ["dist", "acc", "term"] {
        for &id in layer_map[layer].iter() {
            let a = nodes[id as usize]._a;
            let r = radius[layer] + rng.range(-jitter[layer], jitter[layer]);
            nodes[id as usize].x = a.cos() * r;
            nodes[id as usize].z = a.sin() * r;
        }
    }
}

// ── buildTopology ─────────────────────────────────────────────────────────────

#[wasm_bindgen(js_name = buildTopology)]
pub fn build_topology(
    total: u32,
    seed: u32,
    mode: &str,
    rewire_pct: f64,
) -> Result<JsValue, JsValue> {
    let mut rng = Rng::new(seed);
    let (c_core, c_dist, c_acc, c_term) = layer_counts(total);
    let spread = ((c_term * 14) as f64).max(110.0);

    let layer_order = ["core", "dist", "acc", "term"];
    let layer_sizes = [c_core, c_dist, c_acc, c_term];

    let mut nodes: Vec<Node> = Vec::new();
    let mut layer_map: HashMap<&str, Vec<u32>> = HashMap::new();

    for (layer, &count) in layer_order.iter().zip(layer_sizes.iter()) {
        let mut ids = Vec::new();
        for i in 0..count {
            let x = ((i + 1) as f64 / (count + 1) as f64 - 0.5) * spread + rng.range(-4.0, 4.0);
            let z = rng.range(-12.0, 12.0);
            let id = nodes.len() as u32;
            nodes.push(Node {
                id,
                layer: layer.to_string(),
                x,
                y: y_for_layer(layer),
                z,
                is_server: false,
                parent: None,
                children: vec![],
                _a: 0.0,
            });
            ids.push(id);
        }
        layer_map.insert(layer, ids);
    }

    // Find server: term node closest to x=0
    let server_id = *layer_map["term"]
        .iter()
        .min_by(|&&a, &&b| {
            nodes[a as usize].x.abs().partial_cmp(&nodes[b as usize].x.abs()).unwrap()
        })
        .unwrap();
    nodes[server_id as usize].is_server = true;

    // Find srvSwitch: acc node closest to server.x
    let srv_x = nodes[server_id as usize].x;
    let srv_switch_id = *layer_map["acc"]
        .iter()
        .min_by(|&&a, &&b| {
            (nodes[a as usize].x - srv_x).abs().partial_cmp(&(nodes[b as usize].x - srv_x).abs()).unwrap()
        })
        .unwrap();
    let free_acc: Vec<u32> = layer_map["acc"].iter().copied().filter(|&id| id != srv_switch_id).collect();

    let mut tree_edges: Vec<Edge> = Vec::new();

    // Wire core→dist→acc
    let wirable = [("core", "dist"), ("dist", "acc")];
    for (parent_layer, child_layer) in wirable {
        let parents = layer_map[parent_layer].clone();
        let children = layer_map[child_layer].clone();
        for child_id in &children {
            let child_x = nodes[*child_id as usize].x;
            let parent_id = *parents
                .iter()
                .min_by(|&&a, &&b| {
                    (nodes[a as usize].x - child_x).abs().partial_cmp(&(nodes[b as usize].x - child_x).abs()).unwrap()
                })
                .unwrap();
            nodes[*child_id as usize].parent = Some(parent_id);
            nodes[parent_id as usize].children.push(*child_id);
            tree_edges.push(Edge { a: parent_id, b: *child_id });
        }
        // Ensure every parent has at least one child
        for &parent_id in &parents {
            if !nodes[parent_id as usize].children.is_empty() {
                continue;
            }
            let pick_idx = rng.pick(children.len());
            let child_id = children[pick_idx];
            nodes[parent_id as usize].children.push(child_id);
            tree_edges.push(Edge { a: parent_id, b: child_id });
        }
    }

    // Wire server → srvSwitch
    nodes[server_id as usize].parent = Some(srv_switch_id);
    nodes[srv_switch_id as usize].children.push(server_id);
    tree_edges.push(Edge { a: srv_switch_id, b: server_id });

    // Wire other terms → freeAcc (or acc)
    let other_terms: Vec<u32> = layer_map["term"].iter().copied().filter(|&id| id != server_id).collect();
    for &term_id in &other_terms {
        let term_x = nodes[term_id as usize].x;
        let pool = if !free_acc.is_empty() { &free_acc } else { &layer_map["acc"] };
        let parent_id = *pool
            .iter()
            .min_by(|&&a, &&b| {
                (nodes[a as usize].x - term_x).abs().partial_cmp(&(nodes[b as usize].x - term_x).abs()).unwrap()
            })
            .unwrap();
        nodes[term_id as usize].parent = Some(parent_id);
        nodes[parent_id as usize].children.push(term_id);
        tree_edges.push(Edge { a: parent_id, b: term_id });
    }
    // Childless freeAcc nodes
    if !other_terms.is_empty() {
        for &fa_id in &free_acc {
            if !nodes[fa_id as usize].children.is_empty() {
                continue;
            }
            let pick_idx = rng.pick(other_terms.len());
            let child_id = other_terms[pick_idx];
            nodes[fa_id as usize].children.push(child_id);
            tree_edges.push(Edge { a: fa_id, b: child_id });
        }
    }

    assign_radial_positions(&layer_map, &mut nodes, &mut rng);

    // Small-world shortcuts
    let mut shortcut_edges: Vec<Edge> = Vec::new();
    if mode == "smallworld" && rewire_pct > 0.0 {
        let k = ((nodes.len() as f64 * rewire_pct / 100.0).round() as usize).max(1);
        let mut existing: HashSet<u64> = tree_edges.iter().map(|e| edge_key(e.a, e.b)).collect();
        let mut added = 0usize;
        let mut attempts = 0usize;
        let n = nodes.len();
        while added < k && attempts < k * 30 {
            attempts += 1;
            let u = nodes[rng.pick(n)].id;
            let v = nodes[rng.pick(n)].id;
            if u == v { continue; }
            let ul = nodes[u as usize].layer.as_str();
            let vl = nodes[v as usize].layer.as_str();
            if matches!(ul, "core" | "term") || matches!(vl, "core" | "term") { continue; }
            let key = edge_key(u, v);
            if existing.contains(&key) { continue; }
            existing.insert(key);
            shortcut_edges.push(Edge { a: u, b: v });
            added += 1;
        }
    }

    let result = TopologyResult {
        nodes,
        tree_edges,
        shortcut_edges,
        server: server_id,
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

// ── findShortestPath / findTreePath ──────────────────────────────────────────

/// BFS shortest path. adj is a flat array: [node_count, n0_neighbor_count, nb0, nb1, ..., n1_neighbor_count, ...]
/// Returns path as Vec<u32> of node IDs, or empty if unreachable.
#[wasm_bindgen(js_name = findShortestPath)]
pub fn find_shortest_path(
    from: u32,
    to: u32,
    adj_flat: &[u32],   // serialized adjacency list
    parent_flat: &[i64], // parent[i] = parent id or -1
) -> Vec<u32> {
    if from == to {
        return vec![from];
    }
    let node_count = adj_flat[0] as usize;
    // Parse adj_flat into Vec<Vec<u32>>
    let mut adj: Vec<Vec<u32>> = Vec::with_capacity(node_count);
    let mut pos = 1usize;
    for _ in 0..node_count {
        let len = adj_flat[pos] as usize;
        pos += 1;
        let neighbors: Vec<u32> = adj_flat[pos..pos + len].to_vec();
        pos += len;
        adj.push(neighbors);
    }

    let mut visited = vec![false; node_count];
    let mut prev: Vec<Option<u32>> = vec![None; node_count];
    visited[from as usize] = true;
    let mut queue = VecDeque::new();
    queue.push_back(from);

    while let Some(curr) = queue.pop_front() {
        if curr == to {
            let mut path = Vec::new();
            let mut node = to;
            loop {
                path.push(node);
                match prev[node as usize] {
                    Some(p) => node = p,
                    None => break,
                }
            }
            path.reverse();
            return path;
        }
        for &nb in &adj[curr as usize] {
            if !visited[nb as usize] {
                visited[nb as usize] = true;
                prev[nb as usize] = Some(curr);
                queue.push_back(nb);
            }
        }
    }

    // Fallback: tree path
    find_tree_path_inner(from, to, parent_flat)
}

fn find_tree_path_inner(from: u32, to: u32, parent: &[i64]) -> Vec<u32> {
    let mut path_a: Vec<u32> = Vec::new();
    let mut node = from as i64;
    while node >= 0 {
        path_a.push(node as u32);
        node = parent[node as usize];
    }
    let mut path_b: Vec<u32> = Vec::new();
    node = to as i64;
    while node >= 0 {
        path_b.push(node as u32);
        node = parent[node as usize];
    }
    let set_a: HashSet<u32> = path_a.iter().copied().collect();
    let mut ia = path_a.len().saturating_sub(1);
    let mut ib = 0usize;
    for (i, &n) in path_b.iter().enumerate() {
        if set_a.contains(&n) {
            ia = path_a.iter().position(|&x| x == n).unwrap_or(ia);
            ib = i;
            break;
        }
    }
    let mut result = path_a[..=ia].to_vec();
    let tail: Vec<u32> = path_b[..ib].iter().rev().copied().collect();
    result.extend(tail);
    result
}

/// Serialize adjacency map to flat array for findShortestPath.
/// Input: flat pairs [a0, b0, a1, b1, ...], node_count
/// Output: [node_count, deg(0), nb..., deg(1), nb..., ...]
#[wasm_bindgen(js_name = buildAdjFlat)]
pub fn build_adj_flat(node_count: u32, edge_pairs: &[u32]) -> Vec<u32> {
    let n = node_count as usize;
    let mut adj: Vec<Vec<u32>> = vec![vec![]; n];
    let mut i = 0;
    while i + 1 < edge_pairs.len() {
        let a = edge_pairs[i] as usize;
        let b = edge_pairs[i + 1] as usize;
        adj[a].push(b as u32);
        adj[b].push(a as u32);
        i += 2;
    }
    let mut out = vec![node_count];
    for neighbors in &adj {
        out.push(neighbors.len() as u32);
        out.extend_from_slice(neighbors);
    }
    out
}
