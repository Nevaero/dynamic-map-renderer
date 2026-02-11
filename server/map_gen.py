# server/map_gen.py
# Player map generation (fog-of-war compositing)

import os
import re
import time
import logging
from io import BytesIO
from uuid import uuid4
from PIL import Image, ImageDraw, UnidentifiedImageError

from server import config


def generate_player_map(state):
    original_map_path = state.get('original_map_path'); fog_data = state.get('fog_of_war', {}).get('hidden_polygons', [])
    if not original_map_path: logging.debug(f"generate_player_map: No original_map_path."); return None
    full_map_path = os.path.join(config.APP_ROOT, original_map_path)
    if not os.path.exists(full_map_path): logging.error(f"generate_player_map: Original map missing: {full_map_path}"); return None
    output_path = None
    try:
        with Image.open(full_map_path).convert('RGBA') as base_image:
            draw = ImageDraw.Draw(base_image)
            for polygon in fog_data:
                vertices = polygon.get('vertices');
                if not vertices or not isinstance(vertices, list) or len(vertices) < 3: continue
                size_x, size_y = base_image.size; absolute_vertices = []; valid_polygon = True
                for vertex in vertices:
                     if isinstance(vertex, dict) and 'x' in vertex and 'y' in vertex:
                         try: x_coord = max(0, min(int(float(vertex['x']) * size_x), size_x - 1)); y_coord = max(0, min(int(float(vertex['y']) * size_y), size_y - 1)); absolute_vertices.append((x_coord, y_coord))
                         except (ValueError, TypeError): valid_polygon = False; break
                     else: valid_polygon = False; break
                if not valid_polygon or len(absolute_vertices) < 3: continue
                color = polygon.get('color', '#000000');
                try:
                    if not re.match(r'^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$', color): color = '#000000'
                    draw.polygon(absolute_vertices, fill=color)
                except Exception as e: logging.error(f"generate_player_map: Error drawing polygon: {e}")
            timestamp = int(time.time()); output_filename = f"game_{timestamp}_{uuid4().hex[:8]}.png"
            output_path = os.path.join(config.GENERATED_MAPS_FOLDER, output_filename)
            base_image.save(output_path, 'PNG')
        image_url = f"/generated_maps/{output_filename}"; logging.info(f"Generated map image: {output_path} URL: {image_url}"); return image_url
    except UnidentifiedImageError: logging.error(f"generate_player_map: Pillow could not identify: {full_map_path}")
    except Exception as e: logging.error(f"Error generating player map: {e}", exc_info=True)
    return None


def generate_player_map_bytes(state):
    """Generate composited map as JPEG bytes in memory (no disk I/O)."""
    original_map_path = state.get('original_map_path')
    fog_data = state.get('fog_of_war', {}).get('hidden_polygons', [])
    if not original_map_path:
        logging.debug("generate_player_map_bytes: No original_map_path.")
        return None
    full_map_path = os.path.join(config.APP_ROOT, original_map_path)
    if not os.path.exists(full_map_path):
        logging.error(f"generate_player_map_bytes: Original map missing: {full_map_path}")
        return None
    try:
        with Image.open(full_map_path).convert('RGB') as base_image:
            draw = ImageDraw.Draw(base_image)
            for polygon in fog_data:
                vertices = polygon.get('vertices')
                if not vertices or not isinstance(vertices, list) or len(vertices) < 3:
                    continue
                size_x, size_y = base_image.size
                absolute_vertices = []
                valid_polygon = True
                for vertex in vertices:
                    if isinstance(vertex, dict) and 'x' in vertex and 'y' in vertex:
                        try:
                            x_coord = max(0, min(int(float(vertex['x']) * size_x), size_x - 1))
                            y_coord = max(0, min(int(float(vertex['y']) * size_y), size_y - 1))
                            absolute_vertices.append((x_coord, y_coord))
                        except (ValueError, TypeError):
                            valid_polygon = False
                            break
                    else:
                        valid_polygon = False
                        break
                if not valid_polygon or len(absolute_vertices) < 3:
                    continue
                color = polygon.get('color', '#000000')
                try:
                    if not re.match(r'^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$', color):
                        color = '#000000'
                    draw.polygon(absolute_vertices, fill=color)
                except Exception as e:
                    logging.error(f"generate_player_map_bytes: Error drawing polygon: {e}")
            buf = BytesIO()
            base_image.save(buf, format='JPEG', quality=85)
            image_bytes = buf.getvalue()
            logging.info(f"generate_player_map_bytes: Generated {len(image_bytes)} bytes JPEG in memory.")
            return image_bytes
    except UnidentifiedImageError:
        logging.error(f"generate_player_map_bytes: Pillow could not identify: {full_map_path}")
    except Exception as e:
        logging.error(f"Error generating player map bytes: {e}", exc_info=True)
    return None
