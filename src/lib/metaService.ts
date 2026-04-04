import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function getLocations() {
    const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('city', { ascending: true });
    
    if (error) return { success: false, error: error.message };
    return { success: true, locations: data };
}

export async function getCategories() {
    const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });
    
    if (error) return { success: false, error: error.message };
    return { success: true, categories: data };
}

export async function createLocation(locationData: any) {
    const { data, error } = await supabase
        .from('locations')
        .insert([locationData])
        .select()
        .single();
    
    if (error) return { success: false, error: error.message };
    return { success: true, location: data };
}

export async function createCategory(categoryData: any) {
    if (!categoryData.slug) {
        categoryData.slug = categoryData.name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
    }
    
    const { data, error } = await supabase
        .from('categories')
        .insert([categoryData])
        .select()
        .single();
    
    if (error) return { success: false, error: error.message };
    return { success: true, category: data };
}
