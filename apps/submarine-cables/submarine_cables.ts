
declare const d3: any;
declare const topojson: any;
const qs = ((selector: string) => document.querySelector(selector)) as any;
    const API = {
      cables: ['http://localhost:3000/submarine-data/cables', 'https://www.submarinecablemap.com/api/v3/cable/all.json'],
      landings: ['http://localhost:3000/submarine-data/landings', 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json'],
      routes: ['http://localhost:3000/submarine-data/routes', 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json'],
      world: ['https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json']
    };

    const svg = d3.select('#map');
    const tooltip = d3.select('#tooltip');
    const statusEl = qs('#status');
    const searchEl = qs('#search');
    const fromCountryEl = qs('#from-country');
    const toCountryEl = qs('#to-country');
    const landingToggle = qs('#landing-toggle');
    const animateToggle = qs('#animate-toggle');
    const width = () => window.innerWidth;
    const height = () => window.innerHeight;

    let projection;
    let path;
    let routeFeatures = [];
    let landingFeatures = [];
    let cableList = [];
    let worldData = null;
    let focusedCable = '';
    let routeCableIds = new Set();
    let cableCountries = new Map();
    let countryCableIds = new Map();
    let resizeTimer = 0;

    const layer = svg.append('g');
    const oceanLayer = layer.append('g');
    const graticuleLayer = layer.append('g');
    const countryLayer = layer.append('g');
    const cableLayer = layer.append('g');
    const landingLayer = layer.append('g');
    const graticule = d3.geoGraticule10();

    const zoom = d3.zoom()
      .scaleExtent([1, 9])
      .on('zoom', (event) => {
        layer.attr('transform', event.transform);
      });

    svg.call(zoom);
    qs('#reset').addEventListener('click', () => {
      focusedCable = '';
      routeCableIds = new Set();
      searchEl.value = '';
      renderData();
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    });
    searchEl.addEventListener('input', () => {
      focusedCable = searchEl.value.trim().toLowerCase();
      routeCableIds = new Set();
      renderData();
    });
    qs('#route').addEventListener('click', () => {
      focusedCable = '';
      searchEl.value = '';
      buildPlausibleRoute(fromCountryEl.value, toCountryEl.value);
      renderData();
    });
    landingToggle.addEventListener('change', () => {
      landingLayer.selectAll('.landing').classed('hidden', !landingToggle.checked);
    });
    animateToggle.addEventListener('change', () => {
      cableLayer.selectAll('.cable').style('stroke-dasharray', animateToggle.checked ? null : 'none');
    });

    async function fetchFirst(urls) {
      let lastError;
      for (const url of urls) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`${response.status} ${url}`);
          return await response.json();
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    }

    function fitProjection() {
      projection = d3.geoNaturalEarth1()
        .fitExtent([[22, 24], [width() - 22, height() - 24]], { type: 'Sphere' });
      path = d3.geoPath(projection);
      svg.attr('viewBox', `0 0 ${width()} ${height()}`);
    }

    function renderBase(world) {
      fitProjection();
      const countries = topojson.feature(world, world.objects.countries);
      oceanLayer.selectAll('path').data([{ type: 'Sphere' }]).join('path').attr('class', 'sphere').attr('d', path);
      graticuleLayer.selectAll('path').data([graticule]).join('path').attr('class', 'graticule').attr('d', path);
      countryLayer.selectAll('path').data(countries.features).join('path').attr('class', 'country').attr('d', path);
    }

    function routeMatches(feature) {
      if (routeCableIds.size) return routeCableIds.has(feature.properties.id);
      if (!focusedCable) return true;
      const name = (feature.properties.name || '').toLowerCase();
      const id = (feature.properties.id || '').toLowerCase();
      return name.includes(focusedCable) || id.includes(focusedCable);
    }

    function countryFromLanding(feature) {
      const name = feature.properties.name || '';
      const parts = name.split(',').map(part => part.trim()).filter(Boolean);
      return parts.length > 1 ? parts[parts.length - 1] : '';
    }

    function distanceSq(a, b) {
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      return dx * dx + dy * dy;
    }

    function endpointCoordinates(feature) {
      const geometry = feature.geometry;
      if (!geometry) return [];
      if (geometry.type === 'LineString') {
        return [geometry.coordinates[0], geometry.coordinates[geometry.coordinates.length - 1]].filter(Boolean);
      }
      if (geometry.type === 'MultiLineString') {
        return geometry.coordinates.flatMap(line => [line[0], line[line.length - 1]]).filter(Boolean);
      }
      return [];
    }

    function nearestLandingCountry(point) {
      let best = null;
      let bestDistance = Infinity;
      for (const landing of landingFeatures) {
        const dist = distanceSq(point, landing.geometry.coordinates);
        if (dist < bestDistance) {
          bestDistance = dist;
          best = landing;
        }
      }
      return best && bestDistance < 4 ? countryFromLanding(best) : '';
    }

    function indexCableCountries() {
      cableCountries = new Map();
      countryCableIds = new Map();

      for (const route of routeFeatures) {
        const countries = new Set(endpointCoordinates(route).map(nearestLandingCountry).filter(Boolean));
        if (!countries.size) continue;
        cableCountries.set(route.properties.id, countries);
        for (const country of countries) {
          if (!countryCableIds.has(country)) countryCableIds.set(country, new Set());
          countryCableIds.get(country).add(route.properties.id);
        }
      }
    }

    function populateCountrySelectors() {
      const countries = [...countryCableIds.keys()].sort((a, b) => a.localeCompare(b));
      fromCountryEl.replaceChildren(...countries.map(country => new Option(country, country)));
      toCountryEl.replaceChildren(...countries.map(country => new Option(country, country)));
      fromCountryEl.value = countries.includes('Japan') ? 'Japan' : countries[0] || '';
      toCountryEl.value = countries.includes('United States') ? 'United States' : countries[1] || countries[0] || '';
    }

    function findDirectCable(fromCountry, toCountry) {
      return routeFeatures.find(route => {
        const countries = cableCountries.get(route.properties.id);
        return countries && countries.has(fromCountry) && countries.has(toCountry);
      });
    }

    function buildPlausibleRoute(fromCountry, toCountry) {
      routeCableIds = new Set();
      if (!fromCountry || !toCountry || fromCountry === toCountry) {
        statusEl.textContent = 'Choose two different countries';
        statusEl.className = 'status error';
        return;
      }

      const direct = findDirectCable(fromCountry, toCountry);
      if (direct) {
        routeCableIds.add(direct.properties.id);
        statusEl.textContent = `${fromCountry} -> ${toCountry}: direct plausible route via ${direct.properties.name}`;
        statusEl.className = 'status route';
        return;
      }

      for (const hub of countryCableIds.keys()) {
        if (hub === fromCountry || hub === toCountry) continue;
        const first = findDirectCable(fromCountry, hub);
        const second = findDirectCable(hub, toCountry);
        if (first && second) {
          routeCableIds.add(first.properties.id);
          routeCableIds.add(second.properties.id);
          statusEl.textContent = `${fromCountry} -> ${hub} -> ${toCountry}: plausible 1-hop route`;
          statusEl.className = 'status route';
          return;
        }
      }

      statusEl.textContent = `${fromCountry} -> ${toCountry}: no simple route found`;
      statusEl.className = 'status error';
    }

    function simplifyLine(points) {
      if (!Array.isArray(points) || points.length <= 16) return points;
      const step = Math.max(1, Math.ceil(points.length / 90));
      const simplified = points.filter((_, index) => index === 0 || index === points.length - 1 || index % step === 0);
      return simplified.length >= 2 ? simplified : points;
    }

    function simplifyRoute(feature) {
      const geometry = feature.geometry;
      if (!geometry) return feature;
      if (geometry.type === 'LineString') {
        return { ...feature, geometry: { ...geometry, coordinates: simplifyLine(geometry.coordinates) } };
      }
      if (geometry.type === 'MultiLineString') {
        return {
          ...feature,
          geometry: {
            ...geometry,
            coordinates: geometry.coordinates.map(simplifyLine)
          }
        };
      }
      return feature;
    }

	    function renderData() {
	      const visibleRoutes = routeFeatures.filter(routeMatches);
      cableLayer.selectAll('path')
        .data(visibleRoutes, d => d.properties.feature_id || `${d.properties.id}-${d.properties.name}`)
        .join('path')
        .attr('class', d => `cable ${(focusedCable || routeCableIds.size) && routeMatches(d) ? 'focused' : ''}`)
        .attr('d', path)
        .style('--line-color', d => d.properties.color || '#48d3c5')
        .style('stroke-dasharray', animateToggle.checked ? '2 7' : 'none')
        .on('pointermove', (event, d) => showTooltip(event, d.properties.name || d.properties.id))
        .on('pointerleave', hideTooltip);

      landingLayer.selectAll('circle')
        .data(landingFeatures, d => d.properties.id)
        .join('circle')
        .attr('class', `landing${landingToggle.checked ? '' : ' hidden'}`)
        .attr('cx', d => projection(d.geometry.coordinates)[0])
        .attr('cy', d => projection(d.geometry.coordinates)[1])
        .attr('r', 2.4)
        .on('pointermove', (event, d) => showTooltip(event, d.properties.name))
        .on('pointerleave', hideTooltip);

      qs('#route-count').textContent = visibleRoutes.length.toLocaleString();
	      if (!routeCableIds.size) {
	        statusEl.textContent = focusedCable
	          ? `${visibleRoutes.length.toLocaleString()} matching routes`
	          : 'Live data loaded';
	        statusEl.className = 'status';
	      }
	      reportTelemetry(visibleRoutes);
	    }

	    function reportTelemetry(visibleRoutes = routeFeatures.filter(routeMatches)) {
	      window.Telemetry?.report('submarine_cables', {
	        cables: cableList.length,
	        landings: landingFeatures.length,
	        routes: routeFeatures.length,
	        visibleRoutes: visibleRoutes.length,
	        visibleLandings: landingToggle.checked ? landingFeatures.length : 0,
	        focusedCable,
	        routedCableIds: [...routeCableIds],
	        fromCountry: fromCountryEl.value,
	        toCountry: toCountryEl.value,
	                animationEnabled: animateToggle.checked,
        analysis: {
          phase: routeCableIds.size ? 'route_search' : focusedCable ? 'filtering' : 'catalog',
          progress: Math.min(1, visibleRoutes.length / Math.max(1, routeFeatures.length)),
          health: Math.min(1, (countryCableIds.size / 55) * 0.5 + (landingToggle.checked ? 0.3 : 0.1) + (animateToggle.checked ? 0.15 : 0.05)),
          stability: Math.min(1, 1 - Math.abs((routeFeatures.length / Math.max(1, cableList.length)) - 0.9) / 0.9),
          pressure: Math.min(1, routeCableIds.size / 4 + visibleRoutes.length / Math.max(1, routeFeatures.length) * 0.25),
          momentum: Math.min(1, (visibleRoutes.length / Math.max(1, routeFeatures.length)) * 0.7 + (routeCableIds.size > 0 ? 0.3 : 0)),
          activity: Math.min(1, (visibleRoutes.length + (landingToggle.checked ? landingFeatures.length : 0)) / Math.max(1, routeFeatures.length * 1.25)),
          risk: Math.min(1, routeCableIds.size > 1 ? 0.45 : 0.15),
          fun: Math.min(1, 0.2 + (visibleRoutes.length / Math.max(1, routeFeatures.length)) * 0.35 + (routeCableIds.size ? 0.25 : 0.05) + (animateToggle.checked ? 0.15 : 0)),
          summary: `${cableList.length} cables, ${landingFeatures.length} landings, ${routeFeatures.length} routes`,
          signals: [
            { key: 'visibleRoutes', value: visibleRoutes.length, target: routeFeatures.length, weight: 1 },
            { key: 'countryCount', value: countryCableIds.size, target: 40, weight: 0.9 },
            { key: 'routedCableIds', value: routeCableIds.size, target: 0, weight: 0.7 },
          ],
          highlights: [
            `${countryCableIds.size} countries`,
            `${routeCableIds.size} selected route cables`,
            `${visibleRoutes.length} visible / ${routeFeatures.length} total routes`,
          ],
          details: {
            cables: cableList.length,
            landings: landingFeatures.length,
            routes: routeFeatures.length,
            visibleRoutes: visibleRoutes.length,
            visibleLandings: landingToggle.checked ? landingFeatures.length : 0,
            countryCount: countryCableIds.size,
          },
        },
      });
	    }

    function showTooltip(event, text) {
      tooltip
        .style('left', `${event.clientX}px`)
        .style('top', `${event.clientY}px`)
        .style('opacity', 1)
        .text(text || 'Unknown');
    }

    function hideTooltip() {
      tooltip.style('opacity', 0);
    }

    function animateCables() {
      let offset = 0;
      d3.timer(() => {
        if (!animateToggle.checked) return;
        offset = (offset + 0.18) % 9;
        cableLayer.selectAll('.cable').style('stroke-dashoffset', -offset);
      });
    }

    async function init() {
      try {
        const [world, cables, landings, routes] = await Promise.all([
          fetchFirst(API.world),
          fetchFirst(API.cables),
          fetchFirst(API.landings),
          fetchFirst(API.routes)
        ]);
        worldData = world;
        cableList = cables;
        landingFeatures = landings.features || [];
        routeFeatures = (routes.features || []).map(simplifyRoute);
        indexCableCountries();
        populateCountrySelectors();
        qs('#cable-count').textContent = cableList.length.toLocaleString();
        qs('#landing-count').textContent = landingFeatures.length.toLocaleString();
        renderBase(world);
        renderData();
        animateCables();
      } catch (error) {
        statusEl.textContent = `Data load failed: ${error.message}`;
        statusEl.classList.add('error');
      }
    }

    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (worldData) renderBase(worldData);
        renderData();
      }, 120);
    });

    init();
  

