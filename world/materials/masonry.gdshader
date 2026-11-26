shader_type spatial;
render_mode world_vertex_coords;

varying vec3 wpos;
uniform vec4 tint : source_color = vec4(0.56, 0.54, 0.50, 1.0);
uniform vec4 mortar : source_color = vec4(0.30, 0.28, 0.26, 1.0);

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void vertex() {
	wpos = VERTEX;
}

void fragment() {
	float course = 2.5;
	float row = floor(wpos.y * course);
	float along = wpos.x + wpos.z;
	float shift = mod(row, 2.0) * 0.48;
	float fx = fract(along * 1.15 + shift);
	float fy = fract(wpos.y * course);
	vec2 cell = vec2(floor(along * 1.15 + shift), row);
	float line = smoothstep(0.0, 0.08, fx) * smoothstep(0.0, 0.1, fy);
	float dist = length(VERTEX);
	float detail = 1.0 - smoothstep(160.0, 420.0, dist);
	float n = hash(cell);
	vec3 stone = tint.rgb * (0.82 + 0.18 * n);
	stone *= 0.9 + 0.1 * fy;
	ALBEDO = mix(tint.rgb * 0.92, mix(mortar.rgb, stone, line), detail);
	ROUGHNESS = 0.9;
}
