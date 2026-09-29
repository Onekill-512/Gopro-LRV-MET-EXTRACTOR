const fs = require('fs');
const path = require('path');
const gpmfExtract = require('gpmf-extract');
const goproTelemetry = require('gopro-telemetry');

const dossierInput = process.argv[2] || 'E:/DCIM/100GOPRO';
const fichierSortie = path.join(dossierInput, 'parcours_complet.gpx');

const VITESSE_MAX_KMH = 150;
const VITESSE_MAX_MS = VITESSE_MAX_KMH / 3.6;

function calculerDistanceMetres(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function extraireGPX() {
    try {
        const fichiersLRV = fs.readdirSync(dossierInput)
            .filter(f => f.toUpperCase().endsWith('.LRV'))
            .sort();

        if (fichiersLRV.length === 0) {
            console.log('STATUS:Aucun fichier .LRV trouvé');
            return;
        }

        console.log(`STATUS:Analyse GPX de ${fichiersLRV.length} fichiers .LRV...`);
        console.log('PROGRESS:5');

        let tousLesPoints = [];
        let tempsDeDepartGlobal = null;
        let offsetCumuleMs = 0;

        for (let index = 0; index < fichiersLRV.length; index++) {
            const file = fichiersLRV[index];
            const filePath = path.join(dossierInput, file);

            console.log(`STATUS:Lecture de ${file} (${index + 1}/${fichiersLRV.length})...`);
            const pct = 5 + Math.round(((index + 1) / fichiersLRV.length) * 75);
            console.log(`PROGRESS:${pct}`);

            const fileBuffer = fs.readFileSync(filePath);
            const extracted = await gpmfExtract(fileBuffer);
            const telemetry = await goproTelemetry(extracted, {
                stream: ['GPS5'],
                repeatOnError: true
            });

            if (index === 0) {
                if (telemetry && telemetry['1'] && telemetry['1'].streams && telemetry['1'].streams.GPS5 && telemetry['1'].streams.GPS5.date) {
                    tempsDeDepartGlobal = new Date(telemetry['1'].streams.GPS5.date).getTime();
                } else {
                    const stats = fs.statSync(filePath);
                    tempsDeDepartGlobal = stats.birthtimeMs || stats.mtimeMs;
                }
            }

            if (telemetry && telemetry['1'] && telemetry['1'].streams && telemetry['1'].streams.GPS5) {
                const samples = telemetry['1'].streams.GPS5.samples;
                let ctsMaxDuFichier = 0;

                samples.forEach(pt => {
                    if (pt.cts > ctsMaxDuFichier) ctsMaxDuFichier = pt.cts;
                    const timestampAbsolu = tempsDeDepartGlobal + offsetCumuleMs + pt.cts;

                    tousLesPoints.push({
                        lat: pt.value[0],
                        lon: pt.value[1],
                        ele: pt.value[2],
                        speed2D: pt.value[3],
                        timeMs: timestampAbsolu,
                        timeStr: new Date(timestampAbsolu).toISOString()
                    });
                });

                offsetCumuleMs += ctsMaxDuFichier;
            }
        }

        if (tousLesPoints.length === 0) {
            console.log('STATUS:Aucun point GPS trouvé.');
            return;
        }

        console.log('STATUS:Filtrage des anomalies...');
        console.log('PROGRESS:85');

        tousLesPoints.sort((a, b) => a.timeMs - b.timeMs);

        let pointsNettoyes = [];
        let dernierValide = null;

        for (let i = 0; i < tousLesPoints.length; i++) {
            const pt = tousLesPoints[i];
            if (pt.lat === undefined || pt.lon === undefined || isNaN(pt.lat) || isNaN(pt.lon)) continue;
            if (pt.speed2D !== undefined && pt.speed2D > VITESSE_MAX_MS) continue;

            if (dernierValide) {
                const dist = calculerDistanceMetres(dernierValide.lat, dernierValide.lon, pt.lat, pt.lon);
                const dtSeconds = (pt.timeMs - dernierValide.timeMs) / 1000;
                if (dtSeconds > 0 && (dist / dtSeconds) > VITESSE_MAX_MS) continue;
            }

            dernierValide = pt;
            pointsNettoyes.push(pt);
        }

        console.log('STATUS:Génération du fichier GPX...');
        console.log('PROGRESS:95');

        let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GoProLRVToGPX" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Parcours GoPro Sync</name>
    <trkseg>
`;

        pointsNettoyes.forEach(pt => {
            gpxContent += `      <trkpt lat="${pt.lat}" lon="${pt.lon}">\n`;
            if (pt.ele !== undefined) gpxContent += `        <ele>${pt.ele}</ele>\n`;
            gpxContent += `        <time>${pt.timeStr}</time>\n`;
            gpxContent += `      </trkpt>\n`;
        });

        gpxContent += `    </trkseg>
  </trk>
</gpx>`;

        fs.writeFileSync(fichierSortie, gpxContent, 'utf8');
        console.log('PROGRESS:100');
        console.log('STATUS:Terminé ! Fichier parcours_complet.gpx créé.');

    } catch (error) {
        console.error(error);
    }
}

extraireGPX();