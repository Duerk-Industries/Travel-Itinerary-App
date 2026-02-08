import axios from 'axios';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucketName = process.env.LOCATION_BUCKET || 'duerk-travel-itinerary-app-location-data';
const bucket = storage.bucket(bucketName);
const CACHE_TTL_MS = Number(process.env.IMAGE_CACHE_TTL_MS) || 1000 * 60 * 60 * 24 * 7; // 7 days default

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

async function getCachedImageUrl(filepath: string): Promise<string | null> {
    try {
        const file = bucket.file(filepath);
        const [exists] = await file.exists();
        if (!exists) return null;

        const [metadata] = await file.getMetadata();
        const created = new Date(metadata.timeCreated!).getTime();
        if (Date.now() - created > CACHE_TTL_MS) {
            return null;
        }

        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 1000 * 60 * 60, // 1 hour
        });
        return url;
    } catch (error) {
        console.error('Error checking cache:', error);
        return null;
    }
}

async function cacheImage(filepath: string, imageUrl: string): Promise<string> {
    try {
        const file = bucket.file(filepath);
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'stream'
        });

        await new Promise((resolve, reject) => {
            response.data.pipe(file.createWriteStream({
                metadata: {
                    contentType: response.headers['content-type']
                }
            }))
            .on('error', reject)
            .on('finish', resolve);
        });

        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 1000 * 60 * 60, // 1 hour
        });
        return url;
    } catch (error) {
        console.error('Error caching image:', error);
        return imageUrl;
    }
}

/**
 * Fetches an image URL from the Google Places API for a given location.
 * @param {string} locationName The name of the location (e.g., "Paris").
 * @param {string} [placeId] Optional Google Place ID. If provided, skips text search and uses this ID.
 * @returns {Promise<string>} A promise that resolves to an image URL.
 * @throws {Error} If no image can be found.
 */
export async function getGooglePlaceImage(locationName: string, placeId?: string): Promise<string> {
    // Use placeId for cache key if available for stability, otherwise fallback to locationName
    const filename = sanitizeFilename(placeId || locationName);
    const cachePath = `google-places/${filename}.jpg`;
    
    const cachedUrl = await getCachedImageUrl(cachePath);
    if (cachedUrl) return cachedUrl;

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        throw new Error('Google Places API key is not configured.');
    }

    let finalPlaceId = placeId;

    if (!finalPlaceId) {
        // 1. Use Text Search to find a place_id for the location
        const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(locationName)}&key=${apiKey}`;
        const searchResponse = await axios.get(searchUrl);

        if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
            throw new Error('No results found in Google Places Text Search.');
        }
        finalPlaceId = searchResponse.data.results[0].place_id;
    }

    // 2. Use the place_id to get Place Details, including photos
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${finalPlaceId}&fields=photos&key=${apiKey}`;
    const detailsResponse = await axios.get(detailsUrl);

    const photos = detailsResponse.data.result?.photos;
    if (!photos || photos.length === 0) {
        throw new Error('No photos found for the location in Google Place Details.');
    }

    // 3. Get the photo reference and construct the final image URL
    const photoReference = photos[0].photo_reference;
    const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1080&photoreference=${photoReference}&key=${apiKey}`;
    
    let finalUrl: string | undefined;

    // The photo API redirects to the actual image URL. We need to get that final URL.
    try {
        const photoResponse = await axios.get(photoUrl, { maxRedirects: 0, validateStatus: status => status === 302 });
        finalUrl = photoResponse.headers.location;
    } catch (error: any) {
        if (error.response && error.response.headers.location) {
            finalUrl = error.response.headers.location;
        }
    }

    if (!finalUrl) {
        throw new Error('Could not retrieve final Google photo URL.');
    }

    return await cacheImage(cachePath, finalUrl);
}

/**
 * Fetches an image URL from the Unsplash API for a given location.
 * @param {string} locationName The name of the location to search for.
 * @returns {Promise<string>} A promise that resolves to an image URL.
 * @throws {Error} If no image can be found.
 */
export async function getUnsplashImage(locationName: string): Promise<string> {
    const filename = sanitizeFilename(locationName);
    const cachePath = `unsplash/${filename}.jpg`;

    const cachedUrl = await getCachedImageUrl(cachePath);
    if (cachedUrl) return cachedUrl;

    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
        throw new Error('Unsplash Access Key is not configured.');
    }

    const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(locationName)}&per_page=1&orientation=landscape`;
    const unsplashResponse = await axios.get(unsplashUrl, {
        headers: {
            'Authorization': `Client-ID ${accessKey}`
        }
    });

    if (!unsplashResponse.data.results || unsplashResponse.data.results.length === 0) {
        throw new Error('No photos found for the location on Unsplash.');
    }

    const imageUrl = unsplashResponse.data.results[0].urls.regular;
    return await cacheImage(cachePath, imageUrl);
}
