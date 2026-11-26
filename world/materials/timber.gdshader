shader_type spatial;
render_mode world_vertex_coords;

varying vec3 wpos;
uniform vec4 tint : source_color = vec4(0.45, 0.30, 0.16, 1.0);

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void vertex() {
	wpos = VERTEX;
}

void fragment() {
	float along = wpos.x + wpos.z;
	float plank = fract(along * 2.8);
	float seam = smoothstep(0.0, 0.09, plank);
	float grain = noise(vec2(along * 0.35, wpos.y * 3.5));
	vec3 wood = tint.rgb * (0.78 + 0.22 * grain);
	float dist = length(VERTEX);
	float detail = 1.0 - smoothstep(140.0, 360.0, dist);
	ALBEDO = mix(tint.rgb, mix(tint.rgb * 0.42, wood, seam), detail);
	ROUGHNESS = 0.82;
}
